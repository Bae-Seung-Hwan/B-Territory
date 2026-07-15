# 부산 관광 앱 데이터 설명서

- 생성일: 2026-07-06 18:48:23
- 목적: 부산 관광 공모전 앱 개발을 위한 최종 데이터셋 설명
- 핵심 활용: 지도 기반 미션, GPS 인증, 축제/이벤트 추천, 관광 통계 분석

## 1. 최종 산출물

| 파일명 | 설명 | 건수 |
| --- | --- | --- |
| mission_places_final.csv | 앱 미션/GPS 인증에 바로 사용할 장소 데이터 | 219 |
| festivals.csv | 축제 및 행사 데이터 | 45 |
| visitor_stats_long.csv | 관광 통계 long-format 데이터 | 962 |
| code_tables.csv | 지역코드/분류코드 참고표 | 50 |
| missing_detail_report.csv | 누락값 상세 리포트 | 15 |

## 2. 원본 API

| 번호 | API | 활용 데이터 |
| --- | --- | --- |
| 1 | 한국관광공사_국문 관광정보 서비스GW | 관광지, 숙박, 축제, 지역/분류 코드 |
| 2 | 부산광역시관광실태조사 통계정보 서비스 | 방문객 및 소비 관련 통계 |
| 3 | 부산광역시부산명소정보 서비스 | 부산 명소 설명, 이미지, 좌표 |
| 4 | 부산광역시부산축제정보 서비스 | 부산 축제명, 장소, 이미지, 운영정보 |

## 3. 전처리 과정

1. API별 원본 응답을 CSV 형태로 저장
2. 관광지, 숙박, 축제, 통계, 코드표로 역할별 분리
3. 서로 다른 API 컬럼명을 앱에서 쓰기 쉬운 공통 컬럼명으로 정리
4. 좌표, 제목, 주소 등 앱 핵심 필드 기준으로 품질 검수
5. GPS 인증에 필요한 `title`, `address`, `map_x`, `map_y`가 있는 장소만 `mission_places_final.csv`로 추출

## 4. mission_places_final.csv 컬럼 설명

| 컬럼명 | 설명 | 앱 활용 |
| --- | --- | --- |
| mission_id | 앱 내부 미션 ID | 미션 상세 페이지 연결 |
| title | 장소명 | 미션 카드 제목 |
| address | 주소 | 장소 설명 및 지도 표시 |
| map_x | 경도 | GPS 인증 |
| map_y | 위도 | GPS 인증 |
| image_url | 대표 이미지 URL | 미션 카드 이미지 |
| content_type_id | 관광 타입 코드 | 장소 유형 분류 |
| content_type_name | 관광 타입 이름 | 사용자 화면 표시 |
| sigungu_code | 구 코드 또는 구 이름 | 지역 필터 |
| description | 장소 설명 | 상세 페이지 설명 |
| homepage | 공식 홈페이지 | 외부 링크 |
| source | 데이터 출처 | 데이터 신뢰성 확인 |
| source_id | 원본 API ID | 원본 데이터 추적 |

> **`sigungu_code` 혼재 형식 안내**: 소스에 따라 KTO 숫자 코드(`kto_*` 소스)와 한글 구 이름(`busan_attraction` 소스)이 혼재되어 있습니다. 백엔드 시딩 스크립트(`backend/scripts/seed-spots-csv.ts`)가 DB 삽입 시 KTO 표준 부산 구 코드(가나다순 `1` 강서구 ~ `16` 해운대구)로 정규화하므로 DB에는 숫자 코드만 존재합니다. 매핑할 수 없는 새 값이 CSV에 들어오면 시딩이 실패하며 스크립트의 매핑 테이블을 갱신해야 합니다.

## 5. 품질 검수 결과

| 항목 | 결과 |
|---|---:|
| 최종 미션 장소 수 | 215 |
| 중복 제거 전 미션 장소 수 | 219 |
| 제거된 중복 레코드 수 | 4 |
| 원본 places 기준 `source + source_id` 중복 수 | 0 |
| 앱 표시 기준 `title + address` 중복 수 | 4쌍 |
| 좌표 오류 | 0 |
| 좌표 범위 검수 | 부산 범위 밖 좌표 없음 |

## 6. 중복 제거 기준

초기 품질 검수에서는 `source + source_id` 기준으로 중복을 확인했습니다.  
이 기준에서는 원본 API ID가 서로 다르면 다른 데이터로 판단되기 때문에 중복 수가 0건으로 확인되었습니다.

하지만 앱 화면에서는 같은 장소가 두 번 표시되지 않는 것이 중요합니다.  
따라서 최종 앱용 데이터인 `mission_places_final.csv`는 추가로 `title + address` 기준 중복 검증을 수행했습니다.

검증 결과 총 4쌍의 중복 장소가 확인되었습니다.

| 중복 장소 | 중복 원인 |
|---|---|
| 해운대 빛축제 | `kto_area_based`와 `kto_keyword_search`에서 동일 장소가 중복 수집됨 |
| 해운대 가야밀면 | `kto_area_based`와 `kto_keyword_search`에서 동일 장소가 중복 수집됨 |
| 해운대기와집대구탕 | `kto_area_based`와 `kto_keyword_search`에서 동일 장소가 중복 수집됨 |
| 금정산 | `kto_area_based`와 `busan_attraction`에서 유사 장소가 중복 수집됨 |

중복 그룹마다 앱에서 사용하기 더 적합한 레코드 1건만 유지했습니다.  
중복 제거 내역은 `mission_duplicate_report.csv`에 기록했습니다.

- 중복 제거 전: 219건
- 중복 제거 후: 215건
- 중복 제거 리포트: `mission_duplicate_report.csv`|

## 7. 앱 개발 활용 방법

- `mission_places_final.csv`를 지도 마커와 GPS 인증 기준 데이터로 사용
- `image_url`이 비어 있는 경우 앱에서 기본 이미지를 표시
- `description`이 비어 있는 경우 상세 설명 영역을 숨김
- `homepage`가 비어 있는 경우 홈페이지 버튼을 숨김
- `festivals.csv`는 기간 한정 미션이나 이벤트 추천 화면에 사용
- `visitor_stats_long.csv`는 발표 자료의 관광 트렌드 분석과 추천 근거로 사용

## 8. 팀 작업 분담 예시

| 역할 | 담당 데이터 | 작업 |
| --- | --- | --- |
| 지도/GPS | mission_places_final.csv | 지도 마커, 현재 위치 인증 |
| 미션 카드 | mission_places_final.csv | 장소 카드 UI, 이미지 처리 |
| 축제 기능 | festivals.csv | 축제 리스트, 기간 한정 이벤트 |
| 분석/발표 | visitor_stats_long.csv | 통계 시각화, 공모전 발표 근거 |
| 데이터 관리 | DATA_README.md | 데이터 출처와 전처리 과정 관리 |
