/* 부품 사진 파일명 자동화 — UI (logic.js·ocr.js 사용) */
(function () {
  "use strict";
  var L = window.PRLogic, E = window.OCREngines;

  var state = {
    photos: [],      // {name, file, handle|null, thumbUrl, ocr|null}
    groups: [],
    dirHandle: null,
    startNo: 1,
    running: false
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- 설정 (localStorage) ---------- */
  var SETTINGS_KEY = "pr_settings_v1";
  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* 무시 */ }
  }
  function currentEngine() { return $("engine").value; }
  function apiKey() { return $("api-key").value.trim(); }

  function initSettings() {
    var s = loadSettings();
    if (s.engine) $("engine").value = s.engine;
    if (s.keys && s.keys[$("engine").value]) $("api-key").value = s.keys[$("engine").value];
    if (s.brands) $("brand-list").value = s.brands;
    else $("brand-list").value = L.DEFAULT_BRANDS.join("\n");
    if (s.model) $("ai-model").value = s.model;
    onEngineChange();
    renderBrandDatalist();
  }
  function persistSettings() {
    var s = loadSettings();
    s.engine = currentEngine();
    s.keys = s.keys || {};
    if ($("save-key").checked && apiKey()) s.keys[currentEngine()] = apiKey();
    s.brands = $("brand-list").value;
    s.model = $("ai-model").value;
    saveSettings(s);
  }
  function brands() {
    return $("brand-list").value.split(/\n+/).map(function (b) { return b.trim(); }).filter(Boolean);
  }
  function renderBrandDatalist() {
    $("brands-dl").innerHTML = brands().map(function (b) { return "<option value=\"" + esc(b) + "\">"; }).join("");
  }

  var MODEL_OPTIONS = {
    claude: [["claude-opus-5", "Claude Opus 5 (기본·정확)"], ["claude-sonnet-5", "Claude Sonnet 5"], ["claude-haiku-4-5", "Claude Haiku 4.5 (저비용)"]],
    openai: [["gpt-4o", "GPT-4o (기본)"], ["gpt-4o-mini", "GPT-4o mini (저비용)"]],
    upstage: [["ocr", "Document OCR"]],
    tesseract: []
  };
  function onEngineChange() {
    var eng = currentEngine();
    var needKey = eng !== "tesseract";
    $("key-row").style.display = needKey ? "" : "none";
    $("model-row").style.display = MODEL_OPTIONS[eng].length > 1 ? "" : "none";
    $("ai-model").innerHTML = MODEL_OPTIONS[eng].map(function (o) {
      return "<option value=\"" + o[0] + "\">" + esc(o[1]) + "</option>";
    }).join("");
    var s = loadSettings();
    if (s.keys && s.keys[eng]) $("api-key").value = s.keys[eng]; else $("api-key").value = "";
    $("engine-hint").textContent = {
      tesseract: "무료·브라우저 내 처리(사진이 외부로 전송되지 않음). 인쇄 품질에 따라 오독 가능 — 검수 화면에서 수정하세요.",
      claude: "Anthropic API 키 필요. 사진을 Anthropic API로 전송해 판독합니다. 정확도가 가장 높습니다.",
      openai: "OpenAI API 키 필요. 사진을 OpenAI API로 전송해 판독합니다.",
      upstage: "Upstage API 키 필요. Document OCR로 텍스트 추출 후 규칙으로 품번·브랜드를 찾습니다."
    }[eng];
  }

  /* ---------- 사진 불러오기 ---------- */
  function addFiles(entries) {
    // entries: [{name, file, handle|null}]
    entries.sort(function (a, b) { return L.naturalCompare(a.name, b.name); });
    state.photos = entries.map(function (e) {
      return { name: e.name, file: e.file, handle: e.handle || null, thumbUrl: URL.createObjectURL(e.file), ocr: null };
    });
    state.groups = [];
    $("recognize-btn").disabled = state.photos.length === 0;
    $("file-status").textContent = state.photos.length + "장 불러옴" + (state.dirHandle ? " (폴더 모드 — 실제 파일명 변경 가능)" : " (파일 모드 — ZIP/스크립트로 적용)");
    renderPhotosPreview();
    $("review-section").style.display = "none";
    $("apply-section").style.display = "none";
  }

  function isImage(name) { return /\.(jpe?g|png|webp|bmp|heic)$/i.test(name); }

  $("pick-dir").addEventListener("click", function () {
    if (!window.showDirectoryPicker) {
      alert("이 브라우저는 폴더 선택을 지원하지 않습니다(크롬/엣지 권장). [사진 선택]을 이용하세요.");
      return;
    }
    window.showDirectoryPicker({ mode: "readwrite" }).then(function (dir) {
      state.dirHandle = dir;
      var out = [];
      function walk() {
        var it = dir.entries();
        function next() {
          return it.next().then(function (r) {
            if (r.done) return out;
            var name = r.value[0], handle = r.value[1];
            if (handle.kind === "file" && isImage(name)) {
              return handle.getFile().then(function (f) { out.push({ name: name, file: f, handle: handle }); return next(); });
            }
            return next();
          });
        }
        return next();
      }
      return walk();
    }).then(function (out) {
      if (out) addFiles(out);
    }).catch(function (e) { if (e && e.name !== "AbortError") alert(String(e.message || e)); });
  });

  $("pick-files").addEventListener("click", function () { $("file-input").click(); });
  $("file-input").addEventListener("change", function (ev) {
    state.dirHandle = null;
    var entries = Array.prototype.slice.call(ev.target.files)
      .filter(function (f) { return isImage(f.name); })
      .map(function (f) { return { name: f.name, file: f, handle: null }; });
    addFiles(entries);
  });

  function renderPhotosPreview() {
    $("photos-preview").innerHTML = state.photos.map(function (p, i) {
      return "<figure><img src=\"" + p.thumbUrl + "\" alt=\"\"><figcaption>" + (i + 1) + ". " + esc(p.name) + "</figcaption></figure>";
    }).join("");
  }

  /* ---------- 인식 실행 ---------- */
  $("recognize-btn").addEventListener("click", function () {
    if (state.running || !state.photos.length) return;
    var eng = currentEngine();
    if (eng !== "tesseract" && !apiKey()) { alert("선택한 엔진의 API 키를 입력하세요."); return; }
    persistSettings();
    renderBrandDatalist();
    state.running = true;
    $("recognize-btn").disabled = true;
    $("progress-wrap").style.display = "";
    var bl = brands();
    var model = $("ai-model").value;

    var chain = Promise.resolve();
    state.photos.forEach(function (p, i) {
      chain = chain.then(function () {
        setProgress(i, state.photos.length, p.name);
        var run;
        if (eng === "tesseract") run = E.tesseract(p.file, function (st) { $("progress-note").textContent = st; });
        else if (eng === "claude") run = E.claude(p.file, apiKey(), model);
        else if (eng === "openai") run = E.openai(p.file, apiKey(), model);
        else run = E.upstage(p.file, apiKey());
        return run.then(function (res) {
          if (res.part !== undefined) { // 구조화 엔진
            var brandHit = res.brand ? (L.detectBrand(res.brand, bl) || { brand: res.brand, exact: false }) : null;
            p.ocr = { parts: res.part ? [res.part] : [], brand: brandHit, confidence: res.confidence, raw: "" };
          } else {                       // 텍스트 엔진 → 규칙 추출
            p.ocr = {
              parts: L.extractPartCandidates(res.text),
              brand: L.detectBrand(res.text, bl),
              confidence: res.confidence,
              raw: res.text
            };
          }
        }).catch(function (err) {
          p.ocr = { parts: [], brand: null, confidence: 0, raw: "", error: String(err.message || err) };
        });
      });
    });

    chain.then(function () {
      setProgress(state.photos.length, state.photos.length, "완료");
      state.groups = L.groupPhotos(state.photos);
      state.running = false;
      $("recognize-btn").disabled = false;
      renderReview();
      $("review-section").style.display = "";
      $("apply-section").style.display = "";
      $("review-section").scrollIntoView({ behavior: "smooth" });
    });
  });

  function setProgress(done, total, label) {
    $("progress-bar").style.width = Math.round(done / total * 100) + "%";
    $("progress-label").textContent = done + " / " + total + (label ? " — " + label : "");
  }

  /* ---------- 검수 UI ---------- */
  function planNow() { return L.buildRenamePlan(state.photos, state.groups, state.startNo); }

  function renderReview() {
    state.startNo = parseInt($("start-no").value, 10) || 1;
    var plan = planNow();
    var byIdx = {};
    plan.forEach(function (p) { byIdx[p.index] = p; });

    var html = "";
    state.groups.forEach(function (g, gi) {
      var conf = g.confidence;
      var warn = g.needsReview || (conf !== null && conf < 70) || !g.part || !g.brand;
      html += "<div class=\"group" + (warn ? " warn" : "") + "\" data-g=\"" + gi + "\">";
      html += "<div class=\"g-head\"><span class=\"g-title\">부품 " + (gi + 1) + " <span class=\"muted\">(" + g.photoIdxs.length + "장)</span></span>";
      if (warn) html += "<span class=\"badge\">검수 필요</span>";
      if (conf !== null) html += "<span class=\"conf\">인식 신뢰도 " + conf + "%</span>";
      if (gi > 0) html += "<button class=\"mini merge-btn\" data-g=\"" + gi + "\">↰ 이전 부품에 합치기</button>";
      html += "</div>";
      html += "<div class=\"g-fields\"><label>품번 <input class=\"part-in\" data-g=\"" + gi + "\" value=\"" + esc(g.part) + "\" placeholder=\"예: 15KA-72040\"></label>";
      html += "<label>브랜드 <input class=\"brand-in\" data-g=\"" + gi + "\" list=\"brands-dl\" value=\"" + esc(g.brand) + "\" placeholder=\"예: HYUNDAI\"></label></div>";
      html += "<div class=\"g-photos\">";
      g.photoIdxs.forEach(function (idx, pos) {
        var p = state.photos[idx], pl = byIdx[idx];
        html += "<div class=\"ph\"><img src=\"" + p.thumbUrl + "\">";
        html += "<div class=\"ph-info\"><div class=\"old\">" + esc(p.name) + "</div><div class=\"new\">→ " + esc(pl ? pl.newName : "") + "</div>";
        if (p.ocr && p.ocr.error) html += "<div class=\"err\">⚠ " + esc(p.ocr.error) + "</div>";
        html += "</div>";
        if (pos > 0) html += "<button class=\"mini split-btn\" data-idx=\"" + idx + "\">✂ 여기부터 새 부품</button>";
        html += "</div>";
      });
      html += "</div></div>";
    });
    $("groups").innerHTML = html;

    // 이벤트 바인딩
    Array.prototype.forEach.call(document.querySelectorAll(".part-in"), function (el) {
      el.addEventListener("change", function () {
        state.groups[+el.dataset.g].part = el.value.toUpperCase().trim();
        renderReview();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll(".brand-in"), function (el) {
      el.addEventListener("change", function () {
        state.groups[+el.dataset.g].brand = el.value.toUpperCase().trim();
        renderReview();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll(".split-btn"), function (el) {
      el.addEventListener("click", function () {
        L.splitGroup(state.groups, +el.dataset.idx);
        renderReview();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll(".merge-btn"), function (el) {
      el.addEventListener("click", function () {
        L.mergeWithPrev(state.groups, +el.dataset.g);
        renderReview();
      });
    });
  }

  $("start-no").addEventListener("change", renderReview);

  /* ---------- 적용 ---------- */
  $("apply-btn").addEventListener("click", function () {
    var plan = planNow();
    var missing = plan.filter(function (p) { return p.part === "품번미확인" || p.brand === "브랜드미확인"; });
    if (missing.length && !confirm("품번/브랜드 미확인 항목이 " + missing.length + "건 있습니다. 그대로 진행할까요?")) return;

    if (state.dirHandle) {
      applyInFolder(plan);
    } else {
      applyAsZip(plan);
    }
  });

  function applyInFolder(plan) {
    var log = [];
    var chain = Promise.resolve();
    plan.forEach(function (p) {
      chain = chain.then(function () {
        if (p.oldName === p.newName) { log.push("= " + p.oldName + " (변경 없음)"); return; }
        var photo = state.photos[p.index];
        if (!photo.handle) return;
        // move 지원 시 rename, 아니면 복사 후 원본 삭제
        if (typeof photo.handle.move === "function") {
          return photo.handle.move(p.newName).then(function () { log.push("✔ " + p.oldName + " → " + p.newName); });
        }
        return state.dirHandle.getFileHandle(p.newName, { create: true }).then(function (nh) {
          return nh.createWritable().then(function (w) {
            return photo.file.arrayBuffer().then(function (buf) { return w.write(buf).then(function () { return w.close(); }); });
          });
        }).then(function () {
          return state.dirHandle.removeEntry(p.oldName);
        }).then(function () { log.push("✔ " + p.oldName + " → " + p.newName); });
      }).catch(function (e) { log.push("✖ " + p.oldName + ": " + String(e.message || e)); });
    });
    chain.then(function () {
      $("apply-log").textContent = log.join("\n") + "\n\n총 " + plan.length + "건 처리 완료.";
      $("apply-log").style.display = "";
    });
  }

  function applyAsZip(plan) {
    if (typeof JSZip === "undefined") { alert("JSZip 라이브러리가 없습니다."); return; }
    var zip = new JSZip();
    var chain = Promise.resolve();
    plan.forEach(function (p) {
      chain = chain.then(function () {
        return state.photos[p.index].file.arrayBuffer().then(function (buf) { zip.file(p.newName, buf); });
      });
    });
    chain.then(function () { return zip.generateAsync({ type: "blob" }); }).then(function (blob) {
      download(blob, "부품사진_이름변경.zip");
      $("apply-log").textContent = "ZIP 파일로 " + plan.length + "장을 새 이름으로 담아 내려받았습니다.";
      $("apply-log").style.display = "";
    });
  }

  function download(blobOrText, filename, mime) {
    var blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type: mime || "text/plain;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
  }

  $("csv-btn").addEventListener("click", function () { download(L.planToCsv(planNow()), "이름변경_매핑.csv", "text/csv;charset=utf-8"); });
  $("bat-btn").addEventListener("click", function () { download(L.planToBat(planNow()), "이름변경.bat", "text/plain;charset=utf-8"); });

  /* ---------- 초기화 ---------- */
  $("engine").addEventListener("change", onEngineChange);
  $("brand-list").addEventListener("change", function () { persistSettings(); renderBrandDatalist(); });
  initSettings();
})();
