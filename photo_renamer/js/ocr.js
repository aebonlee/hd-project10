/**
 * 인식 엔진 어댑터 — 공통 인터페이스: analyze(photo) → { text?, part?, brand?, confidence? }
 *  - text 반환 엔진(Tesseract/Upstage OCR): 이후 logic.js 규칙으로 품번·브랜드 추출
 *  - 구조화 반환 엔진(Claude/OpenAI 비전): part/brand 직접 반환
 *
 * API 키는 사용자의 브라우저 localStorage에만 저장되며, 해당 제공사 API 호출에만 사용됩니다.
 */
(function (root) {
  "use strict";

  /* ---------- 이미지 유틸 ---------- */
  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("이미지 로드 실패: " + file.name)); };
      img.src = url;
    });
  }

  /** 최대 변 maxSide로 축소한 JPEG dataURL/blob (API 전송·OCR 속도 최적화) */
  function downscale(file, maxSide) {
    return loadImage(file).then(function (r) {
      var w = r.img.naturalWidth, h = r.img.naturalHeight;
      var scale = Math.min(1, (maxSide || 1280) / Math.max(w, h));
      var cw = Math.round(w * scale), ch = Math.round(h * scale);
      var canvas = document.createElement("canvas");
      canvas.width = cw; canvas.height = ch;
      canvas.getContext("2d").drawImage(r.img, 0, 0, cw, ch);
      URL.revokeObjectURL(r.url);
      var dataUrl = canvas.toDataURL("image/jpeg", 0.88);
      return {
        dataUrl: dataUrl,
        base64: dataUrl.split(",")[1],
        blobPromise: new Promise(function (res) { canvas.toBlob(res, "image/jpeg", 0.88); })
      };
    });
  }

  /* ---------- Tesseract (기본, 무료·로컬) ---------- */
  var tessWorker = null;
  function tesseractInit(onStatus) {
    if (tessWorker) return Promise.resolve(tessWorker);
    if (typeof Tesseract === "undefined") return Promise.reject(new Error("Tesseract 라이브러리가 로드되지 않았습니다."));
    return Tesseract.createWorker("eng", 1, {
      workerPath: "lib/worker.min.js",
      corePath: "lib/core",
      langPath: "lib/tessdata",
      gzip: true,
      logger: function (m) {
        if (onStatus && m.status) onStatus(m.status + (m.progress ? " " + Math.round(m.progress * 100) + "%" : ""));
      }
    }).then(function (w) { tessWorker = w; return w; });
  }

  function tesseractAnalyze(file, onStatus) {
    return tesseractInit(onStatus).then(function (worker) {
      return downscale(file, 1600).then(function (d) {
        return worker.recognize(d.dataUrl);
      });
    }).then(function (res) {
      return {
        text: res.data.text || "",
        confidence: typeof res.data.confidence === "number" ? Math.round(res.data.confidence) : null
      };
    });
  }

  /* ---------- Claude (Anthropic) 비전 ---------- */
  function visionPrompt() {
    return "이 사진은 건설기계 부품(필터 등) 사진입니다. 사진에 인쇄/각인된 " +
      "부품 품번(part number, 예: 15KA-72040, 1DFQ-60200, 31Q6-20340-P 같은 형식)과 " +
      "브랜드명(예: HYUNDAI, HYUNDAI CONSTRUCTION EQUIPMENT, DEVELON, FLEETGUARD 등)을 찾아 " +
      "JSON 객체로만 답하세요. 다른 텍스트 금지. 형식: " +
      '{"part_number": "품번 또는 null", "brand": "브랜드 또는 null", "confidence": 0에서 100 사이 숫자}. ' +
      "품번이 여러 개면 가장 크게 인쇄된 것 하나만. 보이지 않으면 null.";
  }

  function parseJsonLoose(text) {
    var m = /\{[\s\S]*\}/.exec(String(text));
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch (e) { return null; }
  }

  function claudeAnalyze(file, apiKey, model) {
    return downscale(file, 1280).then(function (d) {
      return fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({
          model: model || "claude-opus-5",
          max_tokens: 512,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: d.base64 } },
              { type: "text", text: visionPrompt() }
            ]
          }]
        })
      });
    }).then(function (resp) {
      if (!resp.ok) return resp.json().catch(function () { return {}; }).then(function (e) {
        throw new Error("Claude API 오류 " + resp.status + ": " + ((e.error && e.error.message) || resp.statusText));
      });
      return resp.json();
    }).then(function (data) {
      var text = (data.content || []).filter(function (b) { return b.type === "text"; })
        .map(function (b) { return b.text; }).join("\n");
      var j = parseJsonLoose(text) || {};
      return {
        part: j.part_number && j.part_number !== "null" ? String(j.part_number).toUpperCase() : null,
        brand: j.brand && j.brand !== "null" ? String(j.brand).toUpperCase() : null,
        confidence: typeof j.confidence === "number" ? j.confidence : 80
      };
    });
  }

  /* ---------- OpenAI (ChatGPT) 비전 ---------- */
  function openaiAnalyze(file, apiKey, model) {
    return downscale(file, 1280).then(function (d) {
      return fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model || "gpt-4o",
          max_tokens: 300,
          response_format: { type: "json_object" },
          messages: [{
            role: "user",
            content: [
              { type: "text", text: visionPrompt() },
              { type: "image_url", image_url: { url: "data:image/jpeg;base64," + d.base64 } }
            ]
          }]
        })
      });
    }).then(function (resp) {
      if (!resp.ok) return resp.json().catch(function () { return {}; }).then(function (e) {
        throw new Error("OpenAI API 오류 " + resp.status + ": " + ((e.error && e.error.message) || resp.statusText));
      });
      return resp.json();
    }).then(function (data) {
      var text = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : "";
      var j = parseJsonLoose(text) || {};
      return {
        part: j.part_number && j.part_number !== "null" ? String(j.part_number).toUpperCase() : null,
        brand: j.brand && j.brand !== "null" ? String(j.brand).toUpperCase() : null,
        confidence: typeof j.confidence === "number" ? j.confidence : 80
      };
    });
  }

  /* ---------- Upstage (Solar) Document OCR ---------- */
  function upstageAnalyze(file, apiKey) {
    return downscale(file, 1600).then(function (d) {
      return d.blobPromise;
    }).then(function (blob) {
      var fd = new FormData();
      fd.append("document", blob, "photo.jpg");
      fd.append("model", "ocr");
      return fetch("https://api.upstage.ai/v1/document-digitization", {
        method: "POST",
        headers: { "Authorization": "Bearer " + apiKey },
        body: fd
      });
    }).then(function (resp) {
      if (!resp.ok) return resp.text().then(function (t) {
        throw new Error("Upstage API 오류 " + resp.status + ": " + t.slice(0, 200));
      });
      return resp.json();
    }).then(function (data) {
      // document-digitization(ocr) 응답: { text: "...", pages: [...] }
      var text = data.text || (data.pages || []).map(function (p) { return p.text || ""; }).join("\n");
      return { text: text || "", confidence: null };
    });
  }

  root.OCREngines = {
    downscale: downscale,
    tesseract: tesseractAnalyze,
    claude: claudeAnalyze,
    openai: openaiAnalyze,
    upstage: upstageAnalyze
  };
})(typeof self !== "undefined" ? self : this);
