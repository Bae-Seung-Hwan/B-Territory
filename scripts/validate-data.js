#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const BUSAN_BOUNDS = { minLon: 128.5, maxLon: 129.5, minLat: 34.5, maxLat: 35.6 };

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function loadCsv(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
  const rows = parseCsv(raw);
  const header = rows[0];
  return rows.slice(1).map((r) => {
    const record = {};
    header.forEach((col, idx) => {
      record[col] = r[idx] ?? '';
    });
    return record;
  });
}

function checkDuplicates(records, keyFields, label, issues) {
  const seen = new Map();
  records.forEach((r, idx) => {
    const key = keyFields.map((f) => (r[f] || '').trim()).join('|');
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(idx);
  });
  for (const [key, idxs] of seen) {
    if (idxs.length > 1) {
      issues.push(`[${label}] 중복 데이터 (${keyFields.join('+')}="${key}"): 행 ${idxs.map((i) => i + 2).join(', ')}`);
    }
  }
}

function checkRequiredFields(records, fields, label, issues) {
  records.forEach((r, idx) => {
    const missing = fields.filter((f) => !r[f] || r[f].trim() === '');
    if (missing.length > 0) {
      issues.push(`[${label}] 필수 필드 누락 (행 ${idx + 2}): ${missing.join(', ')}`);
    }
  });
}

function checkCoordinates(records, lonField, latField, label, issues) {
  records.forEach((r, idx) => {
    const lonRaw = (r[lonField] || '').trim();
    const latRaw = (r[latField] || '').trim();
    if (!lonRaw || !latRaw) return; // checkRequiredFields already reports missing values

    const lon = parseFloat(lonRaw);
    const lat = parseFloat(latRaw);
    if (Number.isNaN(lon) || Number.isNaN(lat)) {
      issues.push(`[${label}] 좌표 파싱 실패 (행 ${idx + 2}): ${lonField}=${r[lonField]}, ${latField}=${r[latField]}`);
      return;
    }
    if (
      lon < BUSAN_BOUNDS.minLon ||
      lon > BUSAN_BOUNDS.maxLon ||
      lat < BUSAN_BOUNDS.minLat ||
      lat > BUSAN_BOUNDS.maxLat
    ) {
      issues.push(`[${label}] 부산 범위 밖 좌표 (행 ${idx + 2}): lon=${lon}, lat=${lat}`);
    }
  });
}

function checkUnique(records, field, label, issues) {
  const seen = new Map();
  records.forEach((r, idx) => {
    const val = r[field];
    if (!seen.has(val)) seen.set(val, []);
    seen.get(val).push(idx);
  });
  for (const [val, idxs] of seen) {
    if (idxs.length > 1) {
      issues.push(`[${label}] ${field} 중복 (${val}): 행 ${idxs.map((i) => i + 2).join(', ')}`);
    }
  }
}

function validateMissionPlaces(filePath, issues) {
  const records = loadCsv(filePath);
  const label = 'mission_places_final';
  checkRequiredFields(records, ['mission_id', 'title', 'address', 'map_x', 'map_y'], label, issues);
  checkUnique(records, 'mission_id', label, issues);
  checkDuplicates(records, ['title', 'address'], label, issues);
  checkCoordinates(records, 'map_x', 'map_y', label, issues);
  return records.length;
}

function validateFestivals(filePath, issues) {
  const records = loadCsv(filePath);
  const label = 'festivals';
  checkRequiredFields(records, ['title', 'address', 'map_x', 'map_y'], label, issues);
  checkDuplicates(records, ['title', 'address'], label, issues);
  checkCoordinates(records, 'map_x', 'map_y', label, issues);
  return records.length;
}

function validateCodeTables(filePath, issues) {
  const records = loadCsv(filePath);
  const label = 'code_tables';
  checkRequiredFields(records, ['code_type', 'code', 'name'], label, issues);
  checkDuplicates(records, ['code_type', 'code'], label, issues);
  return records.length;
}

function validateVisitorStats(filePath, issues) {
  const records = loadCsv(filePath);
  const label = 'visitor_stats_long';
  checkRequiredFields(records, ['row_no', 'spot', 'metric', 'value'], label, issues);
  return records.length;
}

const DATASETS = [
  { file: 'mission_places_final.csv', validate: validateMissionPlaces },
  { file: 'festivals_fix.csv', validate: validateFestivals },
  { file: 'code_tables.csv', validate: validateCodeTables },
  { file: 'visitor_stats_long.csv', validate: validateVisitorStats },
];

function main() {
  const issues = [];
  let checkedAny = false;

  for (const { file, validate } of DATASETS) {
    const filePath = path.join(DATA_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.log(`[skip] ${file} 없음`);
      continue;
    }
    checkedAny = true;
    const count = validate(filePath, issues);
    console.log(`[ok] ${file} - ${count}건 검사 완료`);
  }

  if (!checkedAny) {
    console.log('검사할 데이터 파일이 없습니다.');
    process.exit(0);
  }

  if (issues.length > 0) {
    console.log(`\n발견된 문제 ${issues.length}건:`);
    issues.forEach((msg) => console.log(`  - ${msg}`));
    process.exit(1);
  }

  console.log('\n모든 데이터 검증 통과.');
}

main();
