import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Callout, Marker, type MapMarker, type Region } from 'react-native-maps';
import Svg, { Path, Circle, Text as SvgText } from 'react-native-svg';
import type { Spot } from '@/api/spots';
import { categoryKey, getCategoryMeta } from '@/constants/mapCategories';
import { BrandColors } from '@/constants/theme';
import type { SpotClaimState } from '@/hooks/use-spot-claim';
import { isCategoryVisible } from '@/utils/mapZoom';
import { useTranslation } from '@/i18n';

type SpotHandler = (spot: Spot) => void;

/** 좌표 파싱을 매 렌더 반복하지 않도록 미리 계산해 둔 스팟 */
export interface SpotPoint {
  spot: Spot;
  coordinate: { latitude: number; longitude: number };
}

interface SpotCalloutProps {
  spot: Spot;
  claimText: string;
  color: string;
  onPress: () => void;
}

// 말풍선 내용만 따로 둔 이유: useTranslation()은 i18n 스토어를 구독하고 매 호출마다 t를 새로
// 바인딩하는데, 이 문구는 열려 있는 말풍선 하나에서만 필요하다. 마커 본체에 두면 화면의
// 마커 수(수십 개)만큼 불필요한 구독이 생긴다.
function SpotCallout({ spot, claimText, color, onPress }: SpotCalloutProps) {
  const { t } = useTranslation();

  return (
    // ⚠️ Callout.onPress는 Android 전용이다(iOS는 Apple Maps에서만 동작하는데 이 앱은 iOS에서도
    // PROVIDER_GOOGLE을 쓴다). iOS 빌드를 시작하면 말풍선 탭이 먹지 않으므로 대안이 필요하다.
    <Callout onPress={onPress}>
      <View style={styles.callout}>
        <Text style={[styles.calloutCategory, { color }]}>
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
  );
}

interface SpotMarkerProps {
  spot: Spot;
  coordinate: { latitude: number; longitude: number };
  /** 이 마커의 점령 현황. 조회 전이거나 다른 마커를 탭한 상태면 null */
  claim: SpotClaimState | null;
  onPress: SpotHandler;
  onSelect: SpotHandler;
}

// 카테고리별 색+이모지 핀을 react-native-svg로 그린다(카카오 버전의 SVG data-URI MarkerImage와
// 동일한 모양). 500개 규모라 초기 레이아웃 이후엔 tracksViewChanges를 꺼서 리렌더 비용을 없앤다.
// memo로 감싸는 이유: 팬/GPS 갱신마다 부모가 리렌더되는데, 그때마다 마커 수십 개의 SVG 트리를
// 다시 만들 이유가 없다. coordinate는 부모가 미리 만들어 identity를 고정해준다(SpotPoint).
const SpotMarker = memo(function SpotMarker({
  spot,
  coordinate,
  claim,
  onPress,
  onSelect,
}: SpotMarkerProps) {
  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  const markerRef = useRef<MapMarker>(null);
  const meta = getCategoryMeta(spot.contenttypeid);
  const claimSettledAt = claim?.settledAt ?? 0;

  // Android 말풍선은 열리는 순간의 내용을 비트맵으로 한 번 찍고 그 뒤로는 갱신되지 않는다
  // (redrawCallout이 네이티브에서 빈 함수이고, 열린 상태로 showInfoWindow()를 다시 불러도
  // 무시된다). 그래서 "열어놓고 나중에 채우기"가 불가능하다.
  //
  // 탭 직후 네이티브가 자동으로 여는 것을 hideCallout()으로 닫아보려 했으나, 자동 열기가 우리
  // 호출보다 늦게 일어나면 닫기가 헛돌고 빈 말풍선이 그대로 굳는 경합이 있었다. 그래서 아예
  // 보여줄 것을 주지 않는다 — claim이 준비되기 전에는 <Callout>을 마운트하지 않으므로
  // (title/description도 없다) 탭해도 열릴 내용이 없고, 조회가 끝난 뒤 여기서 연다.
  const prevSettledAtRef = useRef(claimSettledAt);
  useEffect(() => {
    const settledChanged = prevSettledAtRef.current !== claimSettledAt;
    prevSettledAtRef.current = claimSettledAt;
    // 마운트 직후엔 열지 않는다 — 이미 조회된 마커가 팬으로 언마운트됐다 다시 마운트될 때
    // 탭하지도 않은 말풍선이 저절로 열리는 걸 막기 위함.
    if (!settledChanged || !claimSettledAt) return;

    // 이미 열려 있는 말풍선은 내용이 바뀌어도 다시 그려지지 않으므로 일단 닫는다(닫혀 있으면 무해).
    // 열기는 다음 틱으로 미룬다 — 같은 틱에 닫고 열면 네이티브 명령 큐에서 상쇄되고,
    // 방금 마운트된 Callout이 네이티브에 붙을 시간도 필요하다.
    markerRef.current?.hideCallout();
    const timer = setTimeout(() => markerRef.current?.showCallout(), 0);
    return () => clearTimeout(timer);
  }, [claimSettledAt]);

  const handleLayout = useCallback(() => setTracksViewChanges(false), []);

  const handlePress = useCallback(() => {
    // 같은 마커를 다시 탭하는 경우, 이 시점엔 직전 조회 결과로 만들어진 <Callout>이 아직
    // 마운트돼 있어서 네이티브가 그걸로 말풍선을 연다. 그런데 곧바로 재조회가 시작되면
    // claim이 잠시 null이 되어 <Callout>이 언마운트되고, 이미 열린 말풍선은 내용만 빠진
    // 빈 흰 박스로 남는다(그 상태에선 showCallout()도 "이미 열림"이라 무시된다).
    // 그래서 탭하자마자 닫아, 항상 "닫힌 상태에서 새 내용으로 연다"로 맞춘다.
    markerRef.current?.hideCallout();
    onPress(spot);
  }, [onPress, spot]);
  const handleCalloutPress = useCallback(() => {
    // 상세 시트가 덮고 올라오므로 말풍선은 닫는다. 남겨두면 시트를 닫았을 때 낡은 내용의
    // 말풍선이 그대로 떠 있게 된다(스냅샷이라 그 사이 갱신도 안 된다).
    markerRef.current?.hideCallout();
    onSelect(spot);
  }, [onSelect, spot]);

  return (
    <Marker
      ref={markerRef}
      coordinate={coordinate}
      // title/description(네이티브 기본 말풍선)을 쓰지 않는 이유: 기본 말풍선의 snippet은
      // 여러 줄을 제대로 렌더링하지 않아 주소 아래에 점령 현황을 붙일 수 없다. 내용을 직접
      // 그리는 <Callout>으로 대체한다(tooltip=false라 말풍선 테두리는 기본 모양 그대로 나온다).
      tracksViewChanges={tracksViewChanges}
      onLayout={handleLayout}
      onPress={handlePress}
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

      {claim && (
        <SpotCallout spot={spot} claimText={claim.text} color={meta.color} onPress={handleCalloutPress} />
      )}
    </Marker>
  );
});

const styles = StyleSheet.create({
  // 말풍선 폭을 고정하지 않으면 Android에서 내용이 한 줄로 눌려 잘린다.
  callout: { width: 200, paddingVertical: 2 },
  calloutCategory: { fontSize: 11, fontWeight: '700' },
  calloutTitle: { fontSize: 14, fontWeight: '600', color: '#111' },
  calloutAddr: { marginTop: 2, fontSize: 12, color: '#666' },
  calloutClaim: { marginTop: 4, fontSize: 12, fontWeight: '600', color: BrandColors.accent },
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

/**
 * mapX/mapY는 백엔드에서 문자열(pg decimal)로 오기도 해서 좌표 변환이 필요한데, 이걸 렌더마다
 * 하면 500개 × 2회 파싱이 매번 반복된다. 데이터가 바뀔 때만 한 번 계산해 두고, 덤으로 coordinate
 * 객체의 identity가 고정되어 SpotMarker의 memo가 실제로 동작하게 된다.
 */
export function toSpotPoints(spots: Spot[]): SpotPoint[] {
  const points: SpotPoint[] = [];
  for (const spot of spots) {
    const latitude = Number(spot.mapY);
    const longitude = Number(spot.mapX);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    points.push({ spot, coordinate: { latitude, longitude } });
  }
  return points;
}

interface BuildSpotMarkersOptions {
  activeCategories: Record<string, boolean>;
  zoom: number;
  region: Region;
  /** 현재 선택된 마커의 점령 현황. 어느 마커 것인지도 이 안에 들어 있다 */
  claim: SpotClaimState | null;
  onPress: SpotHandler;
  onSelect: SpotHandler;
}

// 클러스터링을 쓰지 않으므로(BusanMapView 상단 주석 참고) 마커 수를 억제하는 책임이 여기 있다.
// 카테고리/줌 필터에 더해 화면 안에 있는 것만 렌더링해서, 관광지가 몇 개든 실제로 마운트되는
// 마커 수가 화면 단위로 제한되게 한다.
export function buildSpotMarkers(
  points: SpotPoint[],
  options: BuildSpotMarkersOptions,
): React.ReactElement[] {
  const { activeCategories, zoom, region, claim, onPress, onSelect } = options;
  const markers: React.ReactElement[] = [];
  for (const { spot, coordinate } of points) {
    if (!isCategoryVisible(spot.contenttypeid, zoom, activeCategories)) continue;
    if (!isWithinViewport(coordinate.latitude, coordinate.longitude, region)) continue;
    markers.push(
      <SpotMarker
        key={spot.id}
        spot={spot}
        coordinate={coordinate}
        claim={claim?.spotId === spot.id ? claim : null}
        onPress={onPress}
        onSelect={onSelect}
      />,
    );
  }
  return markers;
}
