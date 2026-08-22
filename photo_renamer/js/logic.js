/**
 * 부품 사진 파일명 자동화 — 핵심 로직 (UI/OCR 독립, 브라우저·Node 공용)
 *
 * 파일명 규칙(실제 운영 예시 기준):
 *   {연번 3자리}_{품번}_({브랜드}).JPG   예) 003_31LM-10310_(HYUNDAI).JPG
 *   - 연번은 전체 사진 기준 1씩 증가
 *   - 새 부품의 첫 사진에서 품번·브랜드를 판독, 다음 새 부품 전까지 이어받음
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PRLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- 브랜드 사전 (UI에서 추가 가능) ---------- */
  var DEFAULT_BRANDS = [
    "HYUNDAI CONSTRUCTION EQUIPMENT", "HYUNDAI", "DEVELON", "DOOSAN",
    "FLEETGUARD", "DONALDSON", "MANN FILTER", "SAKURA", "PARKER", "BOSCH",
    "REXROTH", "KYB", "MAHLE", "DENSO", "ZF", "EATON", "KAWASAKI",
    "CUMMINS", "PERKINS", "YANMAR", "KOMATSU", "CATERPILLAR", "CNH",
    "MOBIS", "WIX", "BALDWIN", "HENGST", "FILTRON"
  ];

  /* ---------- 품번 후보 추출 ---------- */
  // 현대건설기계 계열 예: 15KA-72040, 1DFQ-60200, 31LM-10310, 31Q6-20340-P
  var PART_RE = /\b([0-9A-Z]{2,6}-[0-9A-Z]{3,6}(?:-[0-9A-Z]{1,4})?)\b/g;

  function extractPartCandidates(text) {
    if (!text) return [];
    var up = String(text).toUpperCase();
    var out = [], m;
    PART_RE.lastIndex = 0;
    while ((m = PART_RE.exec(up)) !== null) {
      var cand = m[1];
      if (scorePart(cand) > 0) out.push(cand);
    }
    // 점수 내림차순, 중복 제거
    var seen = {};
    return out.sort(function (a, b) { return scorePart(b) - scorePart(a); })
      .filter(function (c) { if (seen[c]) return false; seen[c] = true; return true; });
  }

  /** 품번다움 점수: 숫자+문자 혼합, 적정 길이, 하이픈 구조 */
  function scorePart(s) {
    if (!s || s.length < 7 || s.length > 15) return 0;
    var hasDigit = /\d/.test(s);
    if (!hasDigit) return 0;
    var segs = s.split("-");
    if (segs.length < 2 || segs.length > 3) return 0;
    var score = 10;
    // 전형적 구조: 4자리-5자리(예: 15KA-72040)
    if (/^[0-9A-Z]{4}-\d{5}(-[0-9A-Z]{1,4})?$/.test(s)) score += 20;
    if (/[A-Z]/.test(s)) score += 3;         // 문자 포함(순수 숫자 전화번호류 배제 완화)
    if (/^\d{2,3}-\d{2,4}$/.test(s)) return 0; // 날짜/전화 형태 배제
    return score;
  }

  /* ---------- OCR 혼동 보정 ---------- */
  var CONFUSION = { "O": "0", "Q": "0", "D": "0", "I": "1", "L": "1", "Z": "2", "S": "5", "B": "8", "G": "6" };

  /** 혼동 문자를 정규화한 골격(skeleton) — 같은 부품 여부 비교용 */
  function skeleton(part) {
    return String(part || "").toUpperCase().split("").map(function (ch) {
      return CONFUSION[ch] || ch;
    }).join("");
  }

  /** 두 품번이 OCR 혼동 범위 내에서 같은 부품인지 (O↔0 등 혼동 문자 정규화 후 완전 일치) */
  function samePart(a, b) {
    if (!a || !b) return false;
    a = String(a).toUpperCase(); b = String(b).toUpperCase();
    if (a === b) return true;
    if (a.length !== b.length) return false;
    return skeleton(a) === skeleton(b);
  }

  /* ---------- 브랜드 매칭 ---------- */
  function normalizeWord(w) { return String(w).toUpperCase().replace(/[^A-Z0-9]/g, ""); }

  function levenshtein(a, b) {
    var dp = [];
    for (var i = 0; i <= a.length; i++) { dp[i] = [i]; }
    for (var j = 0; j <= b.length; j++) { dp[0][j] = j; }
    for (i = 1; i <= a.length; i++) {
      for (j = 1; j <= b.length; j++) {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1, dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
    }
    return dp[a.length][b.length];
  }

  /**
   * OCR 텍스트에서 브랜드 탐지. 긴 브랜드(복합어) 우선.
   * 반환: { brand, exact } 또는 null
   */
  function detectBrand(text, brands) {
    if (!text) return null;
    brands = (brands && brands.length ? brands : DEFAULT_BRANDS)
      .slice().sort(function (a, b) { return b.length - a.length; });
    var norm = normalizeWord(text);
    // 1) 정확 포함
    for (var i = 0; i < brands.length; i++) {
      if (norm.indexOf(normalizeWord(brands[i])) !== -1) return { brand: brands[i], exact: true };
    }
    // 2) 단어 단위 퍼지 (5자 이상 단어, 편집거리 1 허용) — 브랜드의 모든 단어가 발견될 때만
    var words = String(text).toUpperCase().split(/[^A-Z]+/).filter(function (w) { return w.length >= 5; });
    function fuzzyHas(target) {
      for (var j = 0; j < words.length; j++) {
        if (Math.abs(words[j].length - target.length) <= 1 && levenshtein(words[j], target) <= 1) return true;
      }
      return false;
    }
    for (i = 0; i < brands.length; i++) {
      var bWords = brands[i].split(/\s+/).map(normalizeWord).filter(function (w) { return w.length >= 5; });
      if (!bWords.length) continue;
      var all = bWords.every(fuzzyHas);
      if (all) return { brand: brands[i], exact: false };
    }
    return null;
  }

  /* ---------- 그룹핑 ----------
   * photos: [{ name, ocr: { parts:[...], brand:{brand,exact}|null, confidence(0~100)|null } }]
   * 규칙: 품번 후보가 있고 현재 그룹 품번과 다르면(혼동 보정 후) 새 그룹 시작.
   *       품번 후보가 없으면 현재 그룹 이어받기. 첫 사진에 품번 없으면 미확인 그룹.
   */
  function groupPhotos(photos) {
    var groups = [];
    var cur = null;
    photos.forEach(function (p, idx) {
      var best = (p.ocr && p.ocr.parts && p.ocr.parts.length) ? p.ocr.parts[0] : null;
      var isNew = false;
      if (!cur) isNew = true;
      else if (best && !samePart(best, cur.part)) isNew = true;

      if (isNew) {
        cur = {
          part: best || "",
          brand: (p.ocr && p.ocr.brand) ? p.ocr.brand.brand : "",
          brandExact: !!(p.ocr && p.ocr.brand && p.ocr.brand.exact),
          needsReview: !best || !(p.ocr && p.ocr.brand),
          confidence: p.ocr && typeof p.ocr.confidence === "number" ? p.ocr.confidence : null,
          photoIdxs: []
        };
        groups.push(cur);
      } else {
        // 이어받는 사진에서 브랜드만 새로 잡히면 보강
        if (!cur.brand && p.ocr && p.ocr.brand) {
          cur.brand = p.ocr.brand.brand;
          cur.brandExact = p.ocr.brand.exact;
        }
      }
      cur.photoIdxs.push(idx);
    });
    return groups;
  }

  /** 검수 UI용: 특정 사진부터 새 그룹으로 분리 */
  function splitGroup(groups, photoIdx) {
    for (var g = 0; g < groups.length; g++) {
      var pos = groups[g].photoIdxs.indexOf(photoIdx);
      if (pos > 0) {
        var moved = groups[g].photoIdxs.splice(pos);
        var ng = {
          part: "", brand: "", brandExact: false, needsReview: true,
          confidence: null, photoIdxs: moved
        };
        groups.splice(g + 1, 0, ng);
        return groups;
      }
      if (pos === 0 && g > 0) return groups; // 이미 그룹 시작점
    }
    return groups;
  }

  /** 검수 UI용: 그룹을 이전 그룹에 합치기 */
  function mergeWithPrev(groups, groupIdx) {
    if (groupIdx <= 0 || groupIdx >= groups.length) return groups;
    var prev = groups[groupIdx - 1], curG = groups[groupIdx];
    prev.photoIdxs = prev.photoIdxs.concat(curG.photoIdxs);
    groups.splice(groupIdx, 1);
    return groups;
  }

  /* ---------- 파일명 생성 ---------- */
  function sanitize(s) {
    return String(s || "").trim()
      .replace(/[\\/:*?"<>|]/g, "")   // 파일명 금지 문자
      .replace(/\s+/g, " ");
  }

  function ext(name) {
    var m = /\.[^.]+$/.exec(String(name));
    return m ? m[0] : ".jpg";
  }

  /**
   * 그룹 + 사진 목록 → [{ index, oldName, newName, part, brand, group }]
   * startNo: 시작 연번(기본 1)
   */
  function buildRenamePlan(photos, groups, startNo) {
    var no = (startNo && startNo > 0) ? startNo : 1;
    var plan = [];
    groups.forEach(function (g, gi) {
      g.photoIdxs.forEach(function (idx) {
        var seq = String(no++).padStart(3, "0");
        var part = sanitize(g.part) || "품번미확인";
        var brand = sanitize(g.brand).toUpperCase() || "브랜드미확인";
        plan.push({
          index: idx,
          oldName: photos[idx].name,
          newName: seq + "_" + part + "_(" + brand + ")" + ext(photos[idx].name),
          part: part, brand: brand, group: gi
        });
      });
    });
    plan.sort(function (a, b) { return a.index - b.index; });
    return plan;
  }

  /* ---------- 자연 정렬 (IMG_2.jpg < IMG_10.jpg) ---------- */
  function naturalCompare(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  }

  /* ---------- CSV / 스크립트 내보내기 ---------- */
  function planToCsv(plan) {
    var rows = ["원본 파일명,새 파일명,품번,브랜드"];
    plan.forEach(function (p) {
      rows.push('"' + p.oldName + '","' + p.newName + '","' + p.part + '","' + p.brand + '"');
    });
    return "﻿" + rows.join("\r\n"); // BOM: 엑셀 한글 호환
  }

  function planToBat(plan) {
    var lines = ["@echo off", "chcp 65001 >nul", "rem 부품 사진 일괄 이름 변경 — 사진 폴더에 두고 실행"];
    plan.forEach(function (p) {
      if (p.oldName !== p.newName) lines.push('ren "' + p.oldName + '" "' + p.newName + '"');
    });
    lines.push("echo 완료 & pause");
    return lines.join("\r\n");
  }

  return {
    DEFAULT_BRANDS: DEFAULT_BRANDS,
    extractPartCandidates: extractPartCandidates,
    scorePart: scorePart,
    skeleton: skeleton,
    samePart: samePart,
    detectBrand: detectBrand,
    groupPhotos: groupPhotos,
    splitGroup: splitGroup,
    mergeWithPrev: mergeWithPrev,
    buildRenamePlan: buildRenamePlan,
    naturalCompare: naturalCompare,
    planToCsv: planToCsv,
    planToBat: planToBat
  };
});
