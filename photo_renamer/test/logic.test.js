/* 부품 사진 자동화 핵심 로직 테스트 — 실행: node test/logic.test.js */
const assert = require("assert");
const L = require("../js/logic.js");

// 품번 후보 추출
assert.deepStrictEqual(L.extractPartCandidates("PART NO 15KA-72040 MADE IN KOREA")[0], "15KA-72040");
assert.deepStrictEqual(L.extractPartCandidates("31Q6-20340-P HYDRAULIC FILTER")[0], "31Q6-20340-P");
assert.ok(L.extractPartCandidates("전화 02-1234 날짜 08-21").length === 0, "전화/날짜 형태 배제");
assert.ok(L.scorePart("1DFQ-60200") > 0);
assert.ok(L.scorePart("ABC-DEF") === 0, "숫자 없는 후보 배제");

// OCR 혼동 보정: O↔0, I↔1, S↔5, B↔8
assert.ok(L.samePart("15KA-72040", "15KA-72040"));
assert.ok(L.samePart("15KA-72O40", "15KA-72040"), "O/0 혼동 동일 판정");
assert.ok(L.samePart("31LM-1O31O", "31LM-10310"));
assert.ok(!L.samePart("15KA-72040", "15KA-71040"), "실제 다른 품번은 구분");
assert.ok(!L.samePart("1DFQ-60200", "1DFQ-60301"));

// 브랜드 매칭 (정확·퍼지·복합어 우선)
assert.strictEqual(L.detectBrand("HYUNDAI CONSTRUCTION EQUIPMENT GENUINE PARTS").brand, "HYUNDAI CONSTRUCTION EQUIPMENT");
assert.strictEqual(L.detectBrand("filter FLEETGUARD lf3000").brand, "FLEETGUARD");
assert.strictEqual(L.detectBrand("HYUNDAl genuine").brand, "HYUNDAI"); // OCR이 I를 l로 읽은 경우
assert.strictEqual(L.detectBrand("no brand here"), null);

// 그룹핑: 새 품번 등장 시 새 그룹, 없으면 이어받기
const photos = [
  { name: "IMG_1.jpg", ocr: { parts: ["15KA-72040"], brand: { brand: "HYUNDAI", exact: true }, confidence: 90 } },
  { name: "IMG_2.jpg", ocr: { parts: [], brand: null, confidence: null } },                       // 이어받음
  { name: "IMG_3.jpg", ocr: { parts: ["1DFQ-60200"], brand: { brand: "FLEETGUARD", exact: true }, confidence: 85 } },
  { name: "IMG_4.jpg", ocr: { parts: ["1DFQ-6O200"], brand: null, confidence: 60 } },             // O/0 혼동 → 같은 부품
  { name: "IMG_5.jpg", ocr: { parts: ["31LM-10310"], brand: null, confidence: 80 } }              // 새 부품, 브랜드 미확인
];
let groups = L.groupPhotos(photos);
assert.strictEqual(groups.length, 3);
assert.deepStrictEqual(groups[0].photoIdxs, [0, 1]);
assert.deepStrictEqual(groups[1].photoIdxs, [2, 3]);
assert.deepStrictEqual(groups[2].photoIdxs, [4]);
assert.strictEqual(groups[1].part, "1DFQ-60200");
assert.ok(groups[2].needsReview, "브랜드 미확인 그룹은 검수 필요 표시");

// 파일명 생성: 연번 3자리 전역 증가 + 품번 + (브랜드)
let plan = L.buildRenamePlan(photos, groups, 1);
assert.strictEqual(plan[0].newName, "001_15KA-72040_(HYUNDAI).jpg");
assert.strictEqual(plan[1].newName, "002_15KA-72040_(HYUNDAI).jpg");
assert.strictEqual(plan[2].newName, "003_1DFQ-60200_(FLEETGUARD).jpg");
assert.strictEqual(plan[3].newName, "004_1DFQ-60200_(FLEETGUARD).jpg");
assert.strictEqual(plan[4].newName, "005_31LM-10310_(브랜드미확인).jpg");

// 그룹 분리/합치기 (검수 UI 조작)
groups = L.splitGroup(groups, 1);            // IMG_2부터 새 그룹으로
assert.strictEqual(groups.length, 4);
assert.deepStrictEqual(groups[0].photoIdxs, [0]);
assert.deepStrictEqual(groups[1].photoIdxs, [1]);
groups = L.mergeWithPrev(groups, 1);          // 다시 합치기
assert.strictEqual(groups.length, 3);
assert.deepStrictEqual(groups[0].photoIdxs, [0, 1]);

// 시작 연번 지정 (기존 파일 이어서 촬영한 경우)
plan = L.buildRenamePlan(photos, groups, 12);
assert.strictEqual(plan[0].newName.slice(0, 3), "012");

// 자연 정렬
const names = ["IMG_10.jpg", "IMG_2.jpg", "IMG_1.jpg"];
names.sort(L.naturalCompare);
assert.deepStrictEqual(names, ["IMG_1.jpg", "IMG_2.jpg", "IMG_10.jpg"]);

// CSV / BAT
const csv = L.planToCsv(plan);
assert.ok(csv.indexOf("원본 파일명,새 파일명") !== -1);
const bat = L.planToBat(plan);
assert.ok(bat.indexOf('ren "IMG_1.jpg" "012_15KA-72040_(HYUNDAI).jpg"') !== -1);

console.log("✅ logic.test.js — 모든 테스트 통과");
