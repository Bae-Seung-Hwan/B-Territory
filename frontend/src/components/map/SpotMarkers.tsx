import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Callout, Marker, type MapMarker, type Region } from 'react-native-maps';
import Svg, { Path, Circle, Text as SvgText } from 'react-native-svg';
import type { Spot } from '@/api/spots';
import { categoryKey, getCategoryMeta } from '@/constants/mapCategories';
import { isCategoryVisible } from '@/utils/mapZoom';
import { useTranslation } from '@/i18n';

export type SpotSelectHandler = (spot: Spot) => void;
export type SpotPressHandler = (spot: Spot) => void;

interface SpotMarkerProps {
  spot: Spot;
  coordinate: { latitude: number; longitude: number };
  /** 이 마커의 점령 현황 문구. 아직 조회 전이거나 다른 마커를 탭한 상태면 null */
  claimText: string | null;
  /** 점령 조회가 끝난 시각. 이 값이 바뀌면 말풍선을 연다(같은 결과가 반복돼도 감지되도록) */
  claimSettledAt: number;
  onPress: SpotPressHandler;
  onSelect: SpotSelectHandler;
}

// 카테고리별 색+이모지 핀을 react-native-svg로 그린다(카카오 버전의 SVG data-URI MarkerImage와
// 동일한 모양). 500개 규모라 초기 레이아웃 이후엔 tracksViewChanges를 꺼서 리렌더 비용을 없앤다.
function SpotMarker({ spot, coordinate, claimText, claimSettledAt, onPress, onSelect }: SpotMarkerProps) {
  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  const markerRef = useRef<MapMarker>(null);
  const meta = getCategoryMeta(spot.contenttypeid);
  const { t } = useTranslation();

  // Android 말풍선은 열리는 순간의 내용을 비트맵으로 한 번 찍고 그 뒤로는 갱신되지 않는다
  // (redrawCallout이 네이티브에서 빈 함수이고, 열린 상태로 showInfoWindow()를 다시 불러도
  // 무시된다). 그래서 "열어놓고 나중에 채우기"가 불가능하다.
  //
  // 탭 직후 네이티브가 자동으로 여는 것을 hideCallout()으로 닫아보려 했으나, 자동 열기가 우리
  // 호출보다 늦게 일어나면 닫기가 헛돌고 빈 말풍선이 그대로 굳는 경합이 있었다. 그래서 아예
  // 보여줄 것을 주지 않는다 — 아래에서 claimText가 준비되기 전까지 <Callout>을 마운트하지
  // 않으므로(title/description도 없다) 탭해도 열릴 내용이 없고, 조회가 끝난 뒤 여기서 연다.
  const prevSettledAtRef = useRef(claimSettledAt);
  useEffect(() => {
    const settledChanged = prevSettledAtRef.current !== claimSettledAt;
    prevSettledAtRef.current = claimSettledAt;
    // 마운트 직후엔 열지 않는다 — 이미 조회된 마커가 팬으로 언마운트됐다 다시 마운트될 때
    // 탭하지도 않은 말풍선이 저절로 열리는 걸 막기 위함.
    if (!settledChanged || !claimText) return;
    // Callout이 방금 마운트됐으므로, 네이티브에 붙은 뒤 열리도록 다음 틱으로 미룬다.
    const timer = setTimeout(() => markerRef.current?.showCallout(), 0);
    return () => clearTimeout(timer);
  }, [claimSettledAt, claimText]);

  return (
    <Marker
      ref={markerRef}
      coordinate={coordinate}
      // title/description(네이티브 기본 말풍선)을 쓰지 않는 이유: 기본 말풍선의 snippet은
      // 여러 줄을 제대로 렌더링하지 않아 주소 아래에 점령 현황을 붙일 수 없다. 내용을 직접
      // 그리는 <Callout>으로 대체한다(tooltip=false라 말풍선 테두리는 기본 모양 그대로 나온다).
      tracksViewChanges={tracksViewChanges}
      onLayout={() => setTracksViewChanges(false)}
      onPress={() => onPress(spot)}
    >
      <Svg width={32} height={40} viewBox="0 0 32 40">
        <Path
          d="M16 0C7.163 0 0 7.163 0 16c0 11.5 16 24 16 24s16-12.5 16-24C32 7.163 24.837 0 16 0z"
          fill={meta.color}
        />
        <Circle cx={16} cy={15} r={10.5} fill="#fff" />
        <SvgText x={16} y={20} fontSize={13} textAnchor="middle">
          {meta.emoji}
        </SvgText>
      </Svg>

      {/* Callout은 마커 아이콘의 일부가 아니라 말풍선으로 따로 인식된다(Android MapMarker.addView).
          ⚠️ Callout.onPress는 Android 전용이다(iOS는 Apple Maps에서만 동작하는데 이 앱은 iOS에서도
          PROVIDER_GOOGLE을 쓴다). iOS 빌드를 시작하면 말풍선 탭이 먹지 않으므로 대안이 필요하다. */}
      {claimText && (
        <Callout
          onPress={() => {
            // 상세 시트가 덮고 올라오므로 말풍선은 닫는다. 남겨두면 시트를 닫았을 때 낡은 내용의
            // 말풍선이 그대로 떠 있게 된다(스냅샷이라 그 사이 갱신도 안 된다).
            markerRef.current?.hideCallout();
            onSelect(spot);
          }}
        >
          <View style={styles.callout}>
            <Text style={[styles.calloutCategory, { color: meta.color }]}>
              {t(`map.categories.${categoryKey(spot.contenttypeid)}`)}
            </Text>
            <Text style={styles.calloutTitle}>{spot.title}</Text>
            {spot.addr1 && (
              <Text style={styles.calloutAddr}>
                {t('map.callout.address')}: {spot.addr1}
              </Text>
            )}
            <Text style={styles.calloutClaim}>
              {t('map.callout.claimStatus')}: {claimText}
            </Text>
          </View>
        </Callout>
      )}
    </Marker>
  );
}

const styles = StyleSheet.create({
  // 말풍선 폭을 고정하지 않으면 Android에서 내용이 한 줄로 눌려 잘린다.
  callout: { width: 200, paddingVertical: 2 },
  calloutCategory: { fontSize: 11, fontWeight: '700' },
  calloutTitle: { fontSize: 14, fontWeight: '600', color: '#111' },
  calloutAddr: { marginTop: 2, fontSize: 12, color: '#666' },
  calloutClaim: { marginTop: 4, fontSize: 12, fontWeight: '600', color: '#208AEF' },
});

// 화면 밖 여유분 — 팬을 시작하자마자 마커가 뿅 나타나지 않도록 뷰포트보다 조금 넓게 잡는다.
// 화면 폭/높이의 25%씩(각 변 기준) 더 본다.
const VIEWPORT_PADDING_RATIO = 0.25;

// region의 latitudeDelta/longitudeDelta는 화면에 보이는 "전체" 범위라, 중심에서 각 변까지는 그 절반이다.
function isWithinViewport(lat: number, lng: number, region: Region): boolean {
  const latRadius = region.latitudeDelta * (0.5 + VIEWPORT_PADDING_RATIO);
  const lngRadius = region.longitudeDelta * (0.5 + VIEWPORT_PADDING_RATIO);
  return Math.abs(lat - region.latitude) <= latRadius && Math.abs(lng - region.longitude) <= lngRadius;
}

// 클러스터링을 쓰지 않으므로(BusanMapView 상단 주석 참고) 마커 수를 억제하는 책임이 여기 있다.
// 카테고리/줌 필터에 더해 화면 안에 있는 것만 렌더링해서, 관광지가 몇 개든 실제로 마운트되는
// 마커 수가 화면 단위로 제한되게 한다.
interface BuildSpotMarkersOptions {
  activeCategories: Record<string, boolean>;
  zoom: number;
  region: Region;
  /** 점령 현황을 조회해둔 관광지 id (마지막으로 탭한 것) */
  claimSpotId: number | null;
  /** 위 관광지의 점령 현황 문구. 조회 중이면 null */
  claimText: string | null;
  /** 점령 조회가 끝난 시각 — 마커가 말풍선을 열 시점을 판단하는 신호 */
  claimSettledAt: number;
  onPress: SpotPressHandler;
  onSelect: SpotSelectHandler;
}

export function buildSpotMarkers(spots: Spot[], options: BuildSpotMarkersOptions): React.ReactElement[] {
  const { activeCategories, zoom, region, claimSpotId, claimText, claimSettledAt, onPress, onSelect } = options;
  const markers: React.ReactElement[] = [];
  for (const spot of spots) {
    const lat = Number(spot.mapY);
    const lng = Number(spot.mapX);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!isCategoryVisible(spot.contenttypeid, zoom, activeCategories)) continue;
    if (!isWithinViewport(lat, lng, region)) continue;
    markers.push(
      <SpotMarker
        key={spot.id}
        spot={spot}
        coordinate={{ latitude: lat, longitude: lng }}
        claimText={spot.id === claimSpotId ? claimText : null}
        claimSettledAt={spot.id === claimSpotId ? claimSettledAt : 0}
        onPress={onPress}
        onSelect={onSelect}
      />,
    );
  }
  return markers;
}
