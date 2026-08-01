import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { BrandColors } from '@/constants/theme';
import { BUSAN_CENTER, BUSAN_BOUNDS } from '@/constants/busan';
import busanSigGeoJson from '@/assets/geo/busan_sig.json';
import type { Spot } from '@/api/spots';

const KAKAO_KEY = process.env.EXPO_PUBLIC_KAKAO_MAP_KEY ?? '';

const MAP_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: ${BrandColors.background}; }
    #map { width: 100%; height: 100vh; }
    #debug {
      position: fixed; bottom: 0; left: 0; right: 0;
      background: rgba(0,0,0,0.85); color: #f66; font-size: 11px;
      padding: 8px; display: none; z-index: 999; word-break: break-all;
    }
    #filter {
      position: absolute; left: 10px; bottom: 18px; z-index: 10;
      background: ${BrandColors.background}D9;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 12px; padding: 6px;
      font-family: system-ui, -apple-system, sans-serif;
      color: #fff; user-select: none; -webkit-user-select: none;
    }
    #filter-header {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      padding: 3px 6px 6px; font-size: 11px; color: #c3c2b7; cursor: pointer;
    }
    #filter-all {
      font-size: 10px; padding: 2px 6px; border-radius: 6px;
      background: rgba(255,255,255,0.1); color: #fff;
    }
    #filter-list { display: flex; flex-direction: column; gap: 3px; }
    #filter.collapsed #filter-list { display: none; }
    #filter.collapsed #filter-header { padding-bottom: 3px; }
    .filter-chip {
      display: flex; align-items: center; gap: 6px;
      padding: 5px 8px; border-radius: 8px; cursor: pointer;
      font-size: 12px; line-height: 1; white-space: nowrap;
      background: rgba(255,255,255,0.06);
    }
    /* 사용자가 끈 카테고리 */
    .filter-chip.off { opacity: 0.35; }
    /* 켜져 있지만 현재 축척에서 자동으로 숨겨진 카테고리 — 왜 안 보이는지 알려준다 */
    .filter-chip.zoom-hidden .filter-label { text-decoration: line-through; opacity: 0.6; }
    .filter-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
    /* 마커 인포윈도우 — 폭을 고정해야 카카오 말풍선이 내용에 맞게 그려진다.
       오른쪽 여백은 removable 닫기 버튼 자리, 긴 한글 주소는 강제 줄바꿈 */
    .iw-content {
      width: 208px;
      padding: 9px 26px 10px 11px;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px; line-height: 1.45; color: #111;
      white-space: normal; word-break: break-word; overflow-wrap: anywhere;
    }
    .iw-title { display: block; font-weight: 600; }
    .iw-addr { margin-top: 3px; font-size: 12px; color: #666; }
    /* 현재 위치 — 카카오맵 기본 "내 위치" UI를 흉내낸 펄스 도트. 마커 이미지 대신
       CustomOverlay + CSS로 그려서 애니메이션(pulse)을 쉽게 넣는다 */
    .my-location-dot {
      width: 16px; height: 16px; border-radius: 50%;
      background: #208AEF; border: 2px solid #fff;
      box-shadow: 0 0 0 2px rgba(32,138,239,0.35);
      position: relative;
    }
    .my-location-dot::after {
      content: '';
      position: absolute; left: 50%; top: 50%;
      width: 32px; height: 32px; margin: -16px 0 0 -16px;
      border-radius: 50%; background: rgba(32,138,239,0.25);
      animation: my-location-pulse 2s ease-out infinite;
    }
    @keyframes my-location-pulse {
      0% { transform: scale(0.4); opacity: 0.8; }
      100% { transform: scale(1); opacity: 0; }
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <div id="filter">
    <div id="filter-header">
      <span>카테고리</span>
      <span id="filter-all">전체</span>
    </div>
    <div id="filter-list"></div>
  </div>
  <div id="debug"></div>
  <script>
    function postToRN(payload) {
      window.ReactNativeWebView &&
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }

    function showDebug(msg) {
      var el = document.getElementById('debug');
      el.style.display = 'block';
      el.textContent = msg;
    }

    window.onerror = function(msg, src, line) {
      showDebug('JS Error: ' + msg + ' (' + src + ':' + line + ')');
      postToRN({ type: 'error', message: msg, source: src, line: line });
    };

    var SIG_GEOJSON = ${JSON.stringify(busanSigGeoJson)};

    function toLatLngPath(ring) {
      return ring.map(function(coord) { return new kakao.maps.LatLng(coord[1], coord[0]); });
    }

    // 실제 국경(폴리곤) 인접 그래프를 그래프 컬러링(4색 정리)해서 배정 —
    // 서로 맞닿은 구끼리는 절대 같은 색을 쓰지 않는다. 4색은 CVD 시뮬레이션에서
    // 6.9(floor band, 국경선 stroke가 2차 구분선 역할을 해서 허용)까지 검증됨.
    var DISTRICT_FILL_COLORS = {
      '26110': '#3987e5', // 중구 - blue
      '26140': '#c98500', // 서구 - yellow
      '26170': '#d55181', // 동구 - magenta
      '26200': '#d55181', // 영도구 - magenta
      '26230': '#3987e5', // 부산진구 - blue
      '26260': '#c98500', // 동래구 - yellow
      '26290': '#c98500', // 남구 - yellow
      '26320': '#008300', // 북구 - green
      '26350': '#3987e5', // 해운대구 - blue
      '26380': '#3987e5', // 사하구 - blue
      '26410': '#d55181', // 금정구 - magenta
      '26440': '#c98500', // 강서구 - yellow
      '26470': '#d55181', // 연제구 - magenta
      '26500': '#008300', // 수영구 - green
      '26530': '#d55181', // 사상구 - magenta
      '26710': '#c98500', // 기장군 - yellow
    };

    // Polygon 등 자치구 경계 shape는 구멍(hole) 없이 외곽 ring만 그린다 — 부산 시군구엔 도넛형 구역이 없음
    function drawDistrictBoundaries(map, geojson) {
      geojson.features.forEach(function(feature) {
        var geom = feature.geometry;
        var fillColor = DISTRICT_FILL_COLORS[feature.properties.SIG_CD] || '#4FC3F7';
        var outerRings = geom.type === 'MultiPolygon'
          ? geom.coordinates.map(function(poly) { return poly[0]; })
          : [geom.coordinates[0]];

        outerRings.forEach(function(ring) {
          new kakao.maps.Polygon({
            map: map,
            path: toLatLngPath(ring),
            strokeWeight: 2,
            strokeColor: '#4FC3F7',
            strokeOpacity: 0.9,
            fillColor: fillColor,
            fillOpacity: 0.1,
          });
        });
      });
    }

    // 정적 <script src>는 WebView HTML string 환경에서 silently fail 가능 →
    // 동적 injection으로 onload/onerror 정확히 캐치
    var sdkScript = document.createElement('script');
    sdkScript.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&libraries=clusterer&autoload=false';

    sdkScript.onload = function() {
      postToRN({ type: 'log', message: 'SDK 스크립트 로드 성공' });
      kakao.maps.load(function() {
        try {
          var map = new kakao.maps.Map(document.getElementById('map'), {
            center: new kakao.maps.LatLng(${BUSAN_CENTER.lat}, ${BUSAN_CENTER.lng}),
            level: 7,
          });
          window.mapInstance = map;

          // Kakao Maps는 한국 밖 타일이 없어 과도하게 축소/이동하면 흰 영역이 보인다 —
          // 축소 상한은 유지하고, 이동 범위는 부산 시군구 bbox(+여유 0.05도)로 제한
          map.setMaxLevel(11);
          var BUSAN_BOUNDS = { minLat: ${BUSAN_BOUNDS.minLat}, maxLat: ${BUSAN_BOUNDS.maxLat}, minLng: ${BUSAN_BOUNDS.minLng}, maxLng: ${BUSAN_BOUNDS.maxLng} };
          kakao.maps.event.addListener(map, 'dragend', function() {
            var center = map.getCenter();
            var lat = center.getLat();
            var lng = center.getLng();
            var clampedLat = Math.min(Math.max(lat, BUSAN_BOUNDS.minLat), BUSAN_BOUNDS.maxLat);
            var clampedLng = Math.min(Math.max(lng, BUSAN_BOUNDS.minLng), BUSAN_BOUNDS.maxLng);
            if (clampedLat !== lat || clampedLng !== lng) {
              map.panTo(new kakao.maps.LatLng(clampedLat, clampedLng));
            }
          });

          // 축소 시 카테고리별 노출 기준(CATEGORY_META.hideFromLevel)을 다시 적용해 혼잡도를 낮춘다
          kakao.maps.event.addListener(map, 'zoom_changed', function() {
            applyMarkerVisibility(map);
            postToRN({
              type: 'log',
              message: 'level=' + map.getLevel() + ' viewportWidth=' + Math.round(getViewportWidthMeters(map)) + 'm',
            });
          });

          drawDistrictBoundaries(map, SIG_GEOJSON);
          syncFilterUI(map.getLevel()); // 마커 도착 전에도 칩이 현재 축척 상태를 반영하도록
          postToRN({ type: 'ready' });
        } catch(e) {
          showDebug('Map init error: ' + e.message);
          postToRN({ type: 'error', message: 'Map init: ' + e.message });
        }
      });
    };

    sdkScript.onerror = function(e) {
      var msg = 'SDK 스크립트 로드 실패 — 네트워크 또는 키/도메인 문제. key=' + '${KAKAO_KEY}'.slice(0,6) + '...';
      showDebug(msg);
      postToRN({ type: 'error', message: msg });
    };

    document.head.appendChild(sdkScript);

    // TourAPI contenttypeid별 마커 설정 — 이 표 하나가 카테고리 동작의 단일 소스다.
    //   color/emoji  : 마커 아이콘 (색상은 dataviz 카테고리 팔레트 8색 재사용,
    //                  식별은 이모지가 1차로 담당하므로 색상끼리 CVD 구분이 흐려도 무방)
    //   hideFromLevel: 이 지도 레벨 이상(= 더 축소)이면 마커를 숨긴다. null이면 항상 표시.
    //                  노출 기준을 바꾸려면 여기 숫자만 고치면 되고, 아래 함수는 손댈 필요 없다.
    //                  (레벨은 숫자가 클수록 축소. 실측상 레벨 7부터 화면 폭이 1km를 넘어간다)
    var CATEGORY_META = {
      '12': { label: '관광지',      color: '#3987e5', emoji: '📍', hideFromLevel: 8 },
      '14': { label: '문화시설',    color: '#9085e9', emoji: '🏛', hideFromLevel: 8 },
      '15': { label: '축제공연행사', color: '#d55181', emoji: '🎪', hideFromLevel: 8 },
      '25': { label: '여행코스',    color: '#199e70', emoji: '🚶', hideFromLevel: 8 },
      '28': { label: '레포츠',      color: '#d95926', emoji: '🏄', hideFromLevel: 8 },
      '32': { label: '숙박',        color: '#c98500', emoji: '🏠', hideFromLevel: 7 },
      '38': { label: '쇼핑',        color: '#e66767', emoji: '🛍', hideFromLevel: 7 },
      '39': { label: '음식점',      color: '#008300', emoji: '🍴', hideFromLevel: 7 },
    };
    var DEFAULT_CATEGORY_META = { label: '기타', color: '#898781', emoji: '📌', hideFromLevel: 7 };

    function getCategoryMeta(contenttypeid) {
      return CATEGORY_META[contenttypeid] || DEFAULT_CATEGORY_META;
    }

    var markerImageCache = {};
    function getMarkerImage(contenttypeid) {
      var key = contenttypeid || 'default';
      if (markerImageCache[key]) return markerImageCache[key];
      var meta = getCategoryMeta(contenttypeid);
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">'
        + '<path d="M16 0C7.163 0 0 7.163 0 16c0 11.5 16 24 16 24s16-12.5 16-24C32 7.163 24.837 0 16 0z" fill="' + meta.color + '"/>'
        + '<circle cx="16" cy="15" r="10.5" fill="#fff"/>'
        + '<text x="16" y="20" font-size="13" text-anchor="middle">' + meta.emoji + '</text>'
        + '</svg>';
      var src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      var image = new kakao.maps.MarkerImage(
        src,
        new kakao.maps.Size(32, 40),
        { offset: new kakao.maps.Point(16, 40) }
      );
      markerImageCache[key] = image;
      return image;
    }

    function escapeHtml(str) {
      return String(str == null ? '' : str).replace(/[&<>"']/g, function(c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    // 카카오맵 문서엔 레벨↔실축척 대응표가 없어서, 화면에 실제로 보이는 폭(m)을
    // bounds 위경도로 직접 계산한다 — 레벨 숫자를 추측해서 하드코딩하지 않기 위함
    function haversineMeters(lat1, lng1, lat2, lng2) {
      var R = 6371000;
      var toRad = function(d) { return d * Math.PI / 180; };
      var dLat = toRad(lat2 - lat1);
      var dLng = toRad(lng2 - lng1);
      var a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function getViewportWidthMeters(map) {
      var bounds = map.getBounds();
      var sw = bounds.getSouthWest();
      var ne = bounds.getNorthEast();
      var midLat = (sw.getLat() + ne.getLat()) / 2;
      return haversineMeters(midLat, sw.getLng(), midLat, ne.getLng());
    }

    // 필터 패널에서 켠/끈 카테고리 (contenttypeid → bool). 미등록 유형은 'default' 키를 공유
    var DEFAULT_CATEGORY_KEY = 'default';
    var activeCategories = { 'default': true };
    Object.keys(CATEGORY_META).forEach(function(id) { activeCategories[id] = true; });

    function categoryKey(contenttypeid) {
      return CATEGORY_META[contenttypeid] ? contenttypeid : DEFAULT_CATEGORY_KEY;
    }

    // 마커가 보이려면 (1) 필터가 켜져 있고 (2) 현재 축척이 노출 기준 안이어야 한다
    function isMarkerVisible(contenttypeid, level) {
      if (!activeCategories[categoryKey(contenttypeid)]) return false;
      var hideFromLevel = getCategoryMeta(contenttypeid).hideFromLevel;
      return hideFromLevel == null || level < hideFromLevel;
    }

    // 기준값은 전부 CATEGORY_META와 activeCategories가 갖고 있으므로
    // 카테고리가 늘거나 노출 기준이 바뀌어도 이 함수는 그대로 둔다.
    function applyMarkerVisibility(map) {
      var level = map.getLevel();
      spotMarkers.forEach(function(entry) {
        entry.marker.setVisible(isMarkerVisible(entry.contenttypeid, level));
      });
      syncFilterUI(level);
    }

    // 필터 패널은 CATEGORY_META를 그대로 순회해 만들어진다 —
    // 카테고리를 추가/삭제해도 이 코드는 손댈 필요 없다.
    function buildFilterUI() {
      var panel = document.getElementById('filter');
      var list = document.getElementById('filter-list');

      Object.keys(CATEGORY_META).forEach(function(id) {
        var meta = CATEGORY_META[id];
        var chip = document.createElement('div');
        chip.className = 'filter-chip';
        chip.setAttribute('data-category', id);
        chip.innerHTML =
          '<span class="filter-dot" style="background:' + meta.color + '"></span>'
          + '<span>' + meta.emoji + '</span>'
          + '<span class="filter-label">' + meta.label + '</span>';
        chip.addEventListener('click', function(e) {
          e.stopPropagation();
          setCategoryActive(id, !activeCategories[id]);
        });
        list.appendChild(chip);
      });

      // '전체' — 하나라도 꺼져 있으면 모두 켜고, 전부 켜져 있으면 모두 끈다
      document.getElementById('filter-all').addEventListener('click', function(e) {
        e.stopPropagation();
        var ids = Object.keys(CATEGORY_META);
        var turnOn = ids.some(function(id) { return !activeCategories[id]; });
        ids.forEach(function(id) { activeCategories[id] = turnOn; });
        activeCategories[DEFAULT_CATEGORY_KEY] = turnOn;
        refreshAfterFilterChange();
      });

      document.getElementById('filter-header').addEventListener('click', function() {
        panel.classList.toggle('collapsed');
      });

      // 패널 위 제스처가 지도 이동/확대로 새지 않도록 차단
      ['touchstart', 'touchmove', 'mousedown', 'wheel', 'dblclick'].forEach(function(evt) {
        panel.addEventListener(evt, function(e) { e.stopPropagation(); });
      });
    }

    function setCategoryActive(id, active) {
      activeCategories[id] = active;
      refreshAfterFilterChange();
    }

    function refreshAfterFilterChange() {
      // 숨겨진 마커에 인포윈도우가 열려 있으면 말풍선만 떠 있게 되므로 닫는다
      if (spotInfoWindow) spotInfoWindow.close();
      if (window.mapInstance) applyMarkerVisibility(window.mapInstance);
    }

    // 칩 상태 = 사용자가 끈 것(off) + 축척 때문에 자동으로 숨겨진 것(zoom-hidden)
    function syncFilterUI(level) {
      Object.keys(CATEGORY_META).forEach(function(id) {
        var chip = document.querySelector('.filter-chip[data-category="' + id + '"]');
        if (!chip) return;
        var hideFromLevel = CATEGORY_META[id].hideFromLevel;
        var zoomHidden = hideFromLevel != null && level >= hideFromLevel;
        chip.classList.toggle('off', !activeCategories[id]);
        chip.classList.toggle('zoom-hidden', activeCategories[id] && zoomHidden);
      });
    }

    var spotMarkers = [];
    var spotInfoWindow = null;
    function updateMarkers(map, spots) {
      if (!spotInfoWindow) spotInfoWindow = new kakao.maps.InfoWindow({ removable: true });
      spotMarkers.forEach(function(entry) { entry.marker.setMap(null); });
      spotMarkers = [];
      var failed = 0;
      spots.forEach(function(spot) {
        var lat = Number(spot.mapY);
        var lng = Number(spot.mapX);
        if (!isFinite(lat) || !isFinite(lng)) return;
        // 커스텀 아이콘 생성이 실패해도 기본 핀으로라도 표시 (전체 마커가 전멸하지 않게)
        var markerImage;
        try {
          markerImage = getMarkerImage(spot.contenttypeid);
        } catch (err) {
          failed++;
        }
        try {
          var markerOptions = { map: map, position: new kakao.maps.LatLng(lat, lng), title: spot.title };
          if (markerImage) markerOptions.image = markerImage;
          var marker = new kakao.maps.Marker(markerOptions);
          kakao.maps.event.addListener(marker, 'click', function() {
            var content = '<div class="iw-content">'
              + '<span class="iw-title">' + escapeHtml(spot.title) + '</span>'
              + (spot.addr1 ? '<div class="iw-addr">' + escapeHtml(spot.addr1) + '</div>' : '')
              + '</div>';
            spotInfoWindow.setContent(content);
            spotInfoWindow.open(map, marker);
          });
          spotMarkers.push({ marker: marker, contenttypeid: spot.contenttypeid });
        } catch (err) {
          failed++;
        }
      });
      applyMarkerVisibility(map);
      postToRN({ type: 'log', message: 'markers: ' + spotMarkers.length + ' shown, ' + failed + ' failed of ' + spots.length });
    }

    var myLocationOverlay = null;
    function updateCurrentLocation(lat, lng) {
      var position = new kakao.maps.LatLng(lat, lng);
      if (myLocationOverlay) {
        myLocationOverlay.setPosition(position);
        return;
      }
      var content = document.createElement('div');
      content.className = 'my-location-dot';
      myLocationOverlay = new kakao.maps.CustomOverlay({
        map: window.mapInstance,
        position: position,
        content: content,
        yAnchor: 0.5,
        zIndex: 5,
      });
    }

    // RN → WebView 메시지 수신
    function handleRNMessage(e) {
      if (!window.mapInstance) return;
      try {
        var msg = JSON.parse(e.data);
        if (msg.type === 'updateMarkers') {
          updateMarkers(window.mapInstance, msg.spots);
        }
        if (msg.type === 'updateLocation') {
          updateCurrentLocation(msg.latitude, msg.longitude);
        }
        if (msg.type === 'panTo') {
          window.mapInstance.panTo(new kakao.maps.LatLng(msg.latitude, msg.longitude));
        }
        // TODO: msg.type === 'updatePolygons'
      } catch (err) {
        showDebug('RN message error: ' + err.message);
        postToRN({ type: 'error', message: 'RN message: ' + err.message });
      }
    }
    document.addEventListener('message', handleRNMessage);
    window.addEventListener('message', handleRNMessage);

    buildFilterUI();
  </script>
</body>
</html>
`;

// 렌더마다 새 객체가 만들어지면 WebView가 source identity 변경을 리로드 트리거로 취급할 수 있어
// (지도 SDK 전체 재주입 비용 발생) 모듈 레벨 상수로 고정한다.
const MAP_SOURCE = { html: MAP_HTML, baseUrl: 'http://localhost' } as const;

interface Coords {
  latitude: number;
  longitude: number;
}

export interface KakaoMapViewHandle {
  panTo: (coords: Coords) => void;
}

interface KakaoMapViewProps {
  style?: StyleProp<ViewStyle>;
  spots?: Spot[];
  coords?: Coords | null;
  onReady?: () => void;
  onError?: (message: string) => void;
}

export const KakaoMapView = forwardRef<KakaoMapViewHandle, KakaoMapViewProps>(function KakaoMapView(
  { style, spots = [], coords = null, onReady, onError },
  ref,
) {
  const webViewRef = useRef<WebView>(null);
  const isMapReadyRef = useRef(false);

  const sendMarkers = useCallback((data: Spot[]) => {
    webViewRef.current?.postMessage(JSON.stringify({ type: 'updateMarkers', spots: data }));
  }, []);

  const sendLocation = useCallback((c: Coords) => {
    webViewRef.current?.postMessage(
      JSON.stringify({ type: 'updateLocation', latitude: c.latitude, longitude: c.longitude }),
    );
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      panTo: (c: Coords) => {
        webViewRef.current?.postMessage(
          JSON.stringify({ type: 'panTo', latitude: c.latitude, longitude: c.longitude }),
        );
      },
    }),
    [],
  );

  const handleMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'ready') {
        console.log('[KakaoMap] 지도 초기화 성공');
        isMapReadyRef.current = true;
        sendMarkers(spots);
        if (coords) sendLocation(coords);
        onReady?.();
      }
      if (msg.type === 'log') {
        console.log('[KakaoMap]', msg.message);
      }
      if (msg.type === 'error') {
        console.error('[KakaoMap Error]', msg.message);
        onError?.(msg.message);
      }
    } catch (_) {}
  };

  useEffect(() => {
    if (isMapReadyRef.current) sendMarkers(spots);
  }, [spots, sendMarkers]);

  useEffect(() => {
    if (isMapReadyRef.current && coords) sendLocation(coords);
  }, [coords, sendLocation]);

  return (
    <WebView
      ref={webViewRef}
      style={style}
      source={MAP_SOURCE}
      originWhitelist={['*']}
      javaScriptEnabled
      domStorageEnabled
      mixedContentMode="always"
      onMessage={handleMessage}
    />
  );
});
