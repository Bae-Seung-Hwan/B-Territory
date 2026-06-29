import { useRef } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

const KAKAO_KEY = process.env.EXPO_PUBLIC_KAKAO_MAP_KEY ?? '';

const BUSAN_LAT = 35.1796;
const BUSAN_LNG = 129.0756;

const MAP_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: #0a0a0f; }
    #map { width: 100%; height: 100vh; }
    #debug {
      position: fixed; bottom: 0; left: 0; right: 0;
      background: rgba(0,0,0,0.85); color: #f66; font-size: 11px;
      padding: 8px; display: none; z-index: 999; word-break: break-all;
    }
  </style>
</head>
<body>
  <div id="map"></div>
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

    // 정적 <script src>는 WebView HTML string 환경에서 silently fail 가능 →
    // 동적 injection으로 onload/onerror 정확히 캐치
    var sdkScript = document.createElement('script');
    sdkScript.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&libraries=clusterer&autoload=false';

    sdkScript.onload = function() {
      postToRN({ type: 'log', message: 'SDK 스크립트 로드 성공' });
      kakao.maps.load(function() {
        try {
          var map = new kakao.maps.Map(document.getElementById('map'), {
            center: new kakao.maps.LatLng(${BUSAN_LAT}, ${BUSAN_LNG}),
            level: 7,
          });
          window.mapInstance = map;
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

    // RN → WebView 메시지 수신
    function handleRNMessage(e) {
      if (!window.mapInstance) return;
      try {
        var msg = JSON.parse(e.data);
        // TODO: msg.type === 'updatePolygons' | 'updateMarkers' | 'panTo'
      } catch (_) {}
    }
    document.addEventListener('message', handleRNMessage);
    window.addEventListener('message', handleRNMessage);
  </script>
</body>
</html>
`;

interface KakaoMapViewProps {
  style?: StyleProp<ViewStyle>;
  onReady?: () => void;
  onError?: (message: string) => void;
}

export function KakaoMapView({ style, onReady, onError }: KakaoMapViewProps) {
  const webViewRef = useRef<WebView>(null);

  const handleMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'ready') {
        console.log('[KakaoMap] 지도 초기화 성공');
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

  return (
    <WebView
      ref={webViewRef}
      style={style}
      source={{ html: MAP_HTML, baseUrl: 'http://localhost' }}
      originWhitelist={['*']}
      javaScriptEnabled
      domStorageEnabled
      mixedContentMode="always"
      onMessage={handleMessage}
    />
  );
}
