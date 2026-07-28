# 부산 관광 앱 데이터 설명서

- 갱신일: 2026-07-23 16:30:02
- 프로젝트: B-Territory
- 목적: 부산 관광 전략 게임 앱 개발을 위한 전처리 데이터 납품
- 저장 위치: data/
- 인코딩: UTF-8 with BOM
- 컬럼 형식: snake_case
- 수치 형식: 콤마·단위 없이 숫자만 사용

## 1. 최종 산출물

| 파일명 | 설명 | 건수/상태 |
| --- | --- | ---: |
| mission_places_final.csv | 앱 미션/GPS 인증용 최종 관광지 데이터 | 215 |
| busan_districts.csv | 부산 16개 구·군 마스터 데이터 | 16 |
| busan_district_foreign_visitor_share.csv | 구·군 외국인 방문 비율 계산 결과 | 16 |
| visitor_stats_long.csv | 관광 통계 long-format 데이터 | 962 |
| festivals_fix.csv | 축제/행사 데이터와 sigungu_code 보강 파일 | 45 |
| busan_districts_boundary.geojson | 부산 16개 구·군 경계 GeoJSON | 16 |
| code_tables.csv | 지역코드/분류코드 참고표 | 50 |
| missing_detail_report.csv | 누락값 상세 리포트 | 15 |
| mission_duplicate_report.csv | 미션 장소 중복 제거 리포트 | 4 |

## 2. 핵심 변경 사항

### mission_places_final.csv

- 최종 미션 장소 데이터는 215건입니다.
- sigungu_code는 KTO areaCode=6 기준 숫자 코드 1~16으로 통일했습니다.
- 한글 구명과 숫자 코드가 섞여 있던 문제를 수정했습니다.
- is_outdoor 컬럼을 추가했습니다.
- is_outdoor 값은 0 또는 1만 사용합니다.
- source_id는 원본 API 조인 키로 유지했습니다.

### busan_districts.csv

- 부산 16개 구·군 마스터 데이터입니다.
- sigungu_code, name_ko, name_en, center_lat, center_lng, kma_nx, kma_ny를 포함합니다.
- foreign_visitor_share, ref_period, source를 채웠습니다.

foreign_visitor_share 정의:

해당 구 외국인 방문자 수 / 부산 16개 구·군 외국인 방문자 수 합계

즉, "부산 전체 외국인 방문 중 해당 구가 차지하는 비중"입니다.

주의:

- 한국관광공사 DataLabService의 이동통신 기반 방문자 수 데이터를 사용했습니다.
- 이 값은 순수 관광 목적 관광객 수와 완전히 동일한 개념은 아니므로, 발표 자료에서는 "외국인 방문자 수 기반 비율"로 표현하는 것을 권장합니다.

### visitor_stats_long.csv

- 총 962행입니다.
- 26개 spot 클러스터 기준으로 대표 sigungu_code를 수동 매핑했습니다.
- sigungu_code 누락 건수: 0건
- 여러 구에 걸치는 클러스터는 대표 관광지 위치 기준으로 구 1개를 지정했습니다.
- 이 데이터는 점령 점수 가중치 보조 근거와 공모전 발표 자료용으로 사용합니다.

### festivals_fix.csv

- 총 45건입니다.
- 주소 또는 장소명으로 판별 가능한 축제는 sigungu_code를 보강했습니다.
- sigungu_code 누락 건수: 1건
- 현재 미매핑으로 남긴 데이터는 원본상 장소가 불명확한 축제입니다.
- 장소 미정 데이터에는 임시 sigungu_code를 넣지 않았습니다.

현재 미매핑 유지 사유:

| title | 사유 |
| --- | --- |
| 2026 원아시아페스티벌(BOF) | 원본 address가 장소 미정 |

## 3. 주요 컬럼 설명

### mission_places_final.csv

| 컬럼 | 설명 |
| --- | --- |
| mission_id | 앱 내부 미션 ID |
| source | 원본 데이터 출처 |
| source_id | 원본 API 고유 ID |
| title | 장소명 |
| address | 주소 |
| map_x | 경도 |
| map_y | 위도 |
| image_url | 대표 이미지 URL |
| content_type | 장소 유형 |
| sigungu_code | KTO areaCode=6 기준 부산 시군구 코드 |
| is_outdoor | 야외 미션 여부, 0 또는 1 |

### busan_districts.csv

| 컬럼 | 설명 |
| --- | --- |
| sigungu_code | KTO areaCode=6 기준 시군구 코드 |
| name_ko | 구·군 국문명 |
| name_en | 구·군 영문명 |
| center_lat | 지도 표시용 대표 중심 위도 |
| center_lng | 지도 표시용 대표 중심 경도 |
| foreign_visitor_share | 부산 전체 외국인 방문 중 해당 구 비중 |
| ref_period | 방문 비율 기준 기간 |
| source | 방문 비율 출처 |
| kma_nx | 기상청 격자 X |
| kma_ny | 기상청 격자 Y |

### visitor_stats_long.csv

| 컬럼 | 설명 |
| --- | --- |
| row_no | 원본 행 번호 |
| spot | 관광 통계상 관광지/클러스터명 |
| metric | 통계 항목 |
| value | 통계 값 |
| sigungu_code | 대표 구·군 코드 |

### festivals_fix.csv

| 컬럼 | 설명 |
| --- | --- |
| source | 원본 출처 |
| source_id | 원본 API 고유 ID |
| title | 축제명 |
| address | 주소 |
| place | 개최 장소 |
| map_x | 경도 |
| map_y | 위도 |
| start_date | 시작일 |
| end_date | 종료일 |
| sigungu_code | 대표 구·군 코드 |

## 4. 부산 시군구 코드 기준

| sigungu_code | 구·군 |
| ---: | --- |
| 1 | 강서구 |
| 2 | 금정구 |
| 3 | 기장군 |
| 4 | 남구 |
| 5 | 동구 |
| 6 | 동래구 |
| 7 | 부산진구 |
| 8 | 북구 |
| 9 | 사상구 |
| 10 | 사하구 |
| 11 | 서구 |
| 12 | 수영구 |
| 13 | 연제구 |
| 14 | 영도구 |
| 15 | 중구 |
| 16 | 해운대구 |

## 5. 원본 API 및 출처

| API/데이터 | 활용 |
| --- | --- |
| 한국관광공사 국문 관광정보 서비스GW | 관광지, 숙박, 축제, 지역코드, 분류코드 |
| 부산광역시 부산명소정보 서비스 | 부산 명소 데이터 보강 |
| 부산광역시 부산축제정보 서비스 | 부산 축제 데이터 보강 |
| 부산광역시 관광실태조사 통계정보 서비스 | 관광 통계 long-format 변환 |
| 한국관광공사 DataLabService 지역별 방문자수_GW | 구·군 외국인 방문 비율 계산 |
| 행정안전부/SGIS 계열 행정경계 데이터 | 부산 구·군 경계 GeoJSON 생성 |

## 6. 백엔드 사용 기준

- 구 단위 점령 집계는 mission_places_final.csv의 sigungu_code 기준으로 GROUP BY 합니다.
- 날씨 API 연동 시 우천 버프는 is_outdoor = 1인 미션에만 적용합니다.
- 관광지별 외국인 방문 비율이 없는 경우 관광지는 소속 구의 foreign_visitor_share를 상속해서 사용할 수 있습니다.
- 축제 데이터는 초기 시딩용으로 사용하고, 이후 KTO searchFestival2 API 동기화로 전환할 수 있습니다.
- busan_districts_boundary.geojson은 구 단위 점령 지도 색칠 렌더링에 사용합니다.

> **`sigungu_code` 혼재 형식 안내 (시딩 정규화)**: mission_places_final.csv의 `sigungu_code`는 소스에 따라 KTO 숫자 코드(`kto_*` 소스)와 한글 구 이름(`busan_attraction` 소스)이 혼재되어 있습니다. 백엔드 시딩 스크립트(`backend/scripts/seed-spots-csv.ts`)가 DB 삽입 시 KTO 표준 부산 구 코드(가나다순 `1` 강서구 ~ `16` 해운대구)로 정규화하므로 DB에는 숫자 코드만 존재합니다. 매핑할 수 없는 새 값이나 빈 값이 CSV에 들어오면 시딩이 실패합니다 (빈 값은 구 집계에서 조용히 누락되는 것을 막기 위해, 매핑 불가 값은 스크립트의 매핑 테이블 갱신이 필요하다는 것을 알리기 위해 각각 실패시킵니다). CSV를 새로 받을 때는 `sigungu_code` 결측 여부를 품질 검수 항목에 포함하세요.

## 7. 검증 요약

| 항목 | 결과 |
| --- | --- |
| mission_places_final.csv sigungu_code 통일 | 완료 |
| mission_places_final.csv is_outdoor 0/1 | 완료 |
| visitor_stats_long.csv sigungu_code 누락 | 0건 |
| festivals_fix.csv sigungu_code 누락 | 1건 |
| busan_districts.csv 외국인 방문 비율 | 반영 |
| busan_districts_boundary.geojson | 완료 |
| mission_places_final.csv sigungu_code 결측(빈 값) | 0건 |
| 주소↔sigungu_code 불일치(원본 오류) | 3건 (아래) |

> **주소↔`sigungu_code` 불일치 (원본 데이터 오류, 코드로 자동 정정 불가)**: 아래 3건은 `sigungu_code` 값 자체는 유효한 숫자 코드라 시딩 정규화(`normalizeSigunguCode`)를 통과하지만, 주소의 구/군과 어긋나 해당 장소의 점령이 엉뚱한 구로 집계되거나 두 장소가 한 행에 병합돼 있습니다. 시딩 스크립트가 주소와 코드를 교차검증해 **경고**로 출력하니(`seed:spots` 로그 확인), CSV 갱신 시 함께 점검하세요.
>
> | mission_id | 내용 |
> |---|---|
> | MISSION_0031 | 주소는 `수영구 광남로 96`인데 `sigungu_code`가 `16`(해운대구) — 코드 오류 |
> | MISSION_0183 | address에 주소 2개 병합 (`서구 ...` + `중구 ...`), 코드는 `15`(중구) |
> | MISSION_0201 | `동래향교`(동래구)+`기장향교`(기장군)가 한 행에 병합, 주소 2개 / 코드는 `6`(동래구) |

## 8. 남은 협의 사항

- 원아시아페스티벌처럼 장소 미정인 축제는 확정 장소 공개 후 sigungu_code를 반영합니다.
- 외국인 방문 비율은 이동통신 기반 방문자 수이므로, 발표 자료에서는 데이터 정의를 함께 설명해야 합니다.
