# 부산 관광 앱 데이터 설명서

- 갱신일: 2026-08-25
- 프로젝트: B-Territory
- 목적: 부산 관광 전략 게임 앱 개발을 위한 전처리 데이터 납품
- 저장 위치: data/
- 인코딩: UTF-8 with BOM
- 컬럼 형식: snake_case
- 수치 형식: 콤마·단위 없이 숫자만 사용

## 1. 최종 산출물

| 파일명 | 설명 | 건수/상태 |
| --- | --- | ---: |
| mission_places_final.csv | 앱 미션/GPS 인증용 최종 관광지 데이터. 숙박 제외 완료 | 197 |
| mission_places_removed_stays.csv | mission_places_final.csv에서 제거한 숙박 데이터 | 18 |
| busan_districts.csv | 부산 16개 구·군 마스터 데이터 | 16 |
| busan_district_foreign_visitor_share.csv | 구·군 외국인 방문 비율 계산 중간 산출물 | 16 |
| visitor_stats_long.csv | 관광 통계 long-format 데이터 | 962 |
| festivals.csv | 앱/백엔드 초기 시딩용 최종 축제 데이터 | 20 |
| festivals_removed_missing_dates.csv | 날짜가 없어 최종 축제 데이터에서 제외한 항목 | 20 |
| festivals_removed_review_issues.csv | 리뷰에서 확인된 날짜 오매칭·중복 제거 항목 | 5 |
| festival_manual_fixes_report.csv | 축제 날짜·주소 수동 보정 근거 리포트 | 8 |
| busan_districts_boundary.geojson | 부산 16개 구·군 경계 GeoJSON | 16 |
| code_tables.csv | 지역코드/분류코드 참고표 | 50 |

## 2. 핵심 변경 사항

### mission_places_final.csv

- 최종 미션 장소 데이터는 197건입니다.
- 숙박 데이터(content_type_id=32, content_type_name=숙박) 18건을 제거했습니다.
- 제거된 숙박 목록은 mission_places_removed_stays.csv에 별도 기록했습니다.
- sigungu_code는 KTO areaCode=6 기준 숫자 코드 1~16으로 통일했습니다.
- is_outdoor 컬럼을 추가했으며 값은 0 또는 1만 사용합니다.
- source_id는 원본 API 조인 키로 유지했습니다.

주의:

- 이미 시딩된 DB에서는 CSV에서 제거된 숙박 18건이 자동 삭제되지 않을 수 있습니다.
- 기존 spots 데이터 정리는 서비스 기록(spot_claims, mission_photos, reviews 등)과의 관계를 확인한 뒤 별도 마이그레이션 또는 운영 스크립트로 처리해야 합니다.

### festivals.csv

- 최종 축제 데이터는 20건입니다.
- 기존 festivals_fix.csv 45건을 아래처럼 분할했습니다.
  - festivals.csv: 20건
  - festivals_removed_missing_dates.csv: 20건
  - festivals_removed_review_issues.csv: 5건
- 날짜가 없거나 날짜 오매칭이 확인된 축제는 최종 시딩 파일에서 제외했습니다.
- 수동 보정한 날짜·주소 근거는 festival_manual_fixes_report.csv에 기록했습니다.
- 2026-08-25 기준 종료된 축제도 일부 포함되어 있습니다. 백엔드 조회 API에서 end_date 기준으로 노출 여부를 필터링합니다.

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
- 백엔드 시딩 기준 source of truth는 busan_districts.csv입니다.

### visitor_stats_long.csv

- 총 962행입니다.
- 26개 spot 클러스터 기준으로 대표 sigungu_code를 수동 매핑했습니다.
- sigungu_code 누락 건수: 0건
- 여러 구에 걸치는 클러스터는 대표 관광지 위치 기준으로 구 1개를 지정했습니다.
- 이 데이터는 점령 점수 가중치 보조 근거와 공모전 발표 자료용으로 사용합니다.

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
| content_type_id | KTO contenttypeid 기반 장소 유형 ID |
| content_type_name | 장소 유형명 |
| sigungu_code | KTO areaCode=6 기준 부산 시군구 코드 |
| description | 장소 설명 |
| homepage | 홈페이지 |
| is_outdoor | 야외 미션 여부, 0 또는 1 |

### festivals.csv

| 컬럼 | 설명 |
| --- | --- |
| source | 원본 출처 |
| source_id | 원본 API 고유 ID |
| title | 축제명 |
| address | 주소 |
| place | 개최 장소 |
| map_x | 경도 |
| map_y | 위도 |
| image_url | 대표 이미지 URL |
| start_date | 시작일, YYYYMMDD |
| end_date | 종료일, YYYYMMDD |
| usage_time | 원본 운영/행사 기간 문구 |
| tel | 문의 전화 |
| description | 축제 설명 |
| homepage | 홈페이지 |
| sigungu_code | 대표 구·군 코드 |

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
| 한국관광공사 국문 관광정보 서비스GW | 관광지, 축제, 지역코드, 분류코드 |
| 부산광역시 부산명소정보 서비스 | 부산 명소 데이터 보강 |
| 부산광역시 부산축제정보 서비스 | 부산 축제 데이터 보강 |
| 부산광역시 관광실태조사 통계정보 서비스 | 관광 통계 long-format 변환 |
| 한국관광공사 DataLabService 지역별 방문자수_GW | 구·군 외국인 방문 비율 계산 |
| 구·군별 문화축제 CSV | 축제 날짜 보강 |
| 행정안전부/SGIS 계열 행정경계 데이터 | 부산 구·군 경계 GeoJSON 생성 |

## 6. 백엔드 사용 기준

- 구 단위 점령 집계는 mission_places_final.csv의 sigungu_code 기준으로 GROUP BY 합니다.
- 날씨 API 연동 시 우천 버프는 is_outdoor = 1인 미션에만 적용합니다.
- 관광지별 외국인 방문 비율이 없는 경우 관광지는 소속 구의 foreign_visitor_share를 상속해서 사용할 수 있습니다.
- 축제 초기 시딩 기준 파일은 festivals.csv입니다.
- 날짜가 없거나 오매칭으로 제외한 축제는 festivals_removed_missing_dates.csv와 festivals_removed_review_issues.csv에서 확인합니다.
- busan_districts_boundary.geojson은 구 단위 점령 지도 색칠 렌더링에 사용합니다.

## 7. 검증 요약

| 항목 | 결과 |
| --- | --- |
| mission_places_final.csv 행 수 | 197건 |
| mission_places_final.csv 숙박 잔존 | 0건 |
| mission_places_final.csv sigungu_code 통일 | 완료 |
| mission_places_final.csv is_outdoor 0/1 | 완료 |
| mission_places_removed_stays.csv 행 수 | 18건 |
| festivals.csv 행 수 | 20건 |
| festivals.csv 필수 필드 누락 | 0건 |
| festivals.csv end_date < start_date | 0건 |
| 축제 데이터 분할 합계 | 20 + 20 + 5 = 45건 |
| visitor_stats_long.csv sigungu_code 누락 | 0건 |
| busan_districts.csv 외국인 방문 비율 | 반영 |
| busan_districts_boundary.geojson | 완료 |

## 8. 남은 협의 사항

- 이미 시딩된 DB에서 숙박 18건을 삭제할지, 비활성 처리할지는 백엔드 데이터 보존 정책에 따라 결정해야 합니다.
- 축제 데이터 중 종료된 행사는 백엔드 조회 API에서 end_date 기준으로 노출 여부를 필터링합니다.
- 외국인 방문 비율은 이동통신 기반 방문자 수이므로, 발표 자료에서는 데이터 정의를 함께 설명해야 합니다.
