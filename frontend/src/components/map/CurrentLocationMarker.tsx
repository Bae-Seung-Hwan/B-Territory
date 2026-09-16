import { memo } from 'react';
import { BrandColors } from '@/constants/theme';
import { MapPin } from './MapPin';

interface CurrentLocationMarkerProps {
  coordinate: { latitude: number; longitude: number };
}

export const CurrentLocationMarker = memo(function CurrentLocationMarker({
  coordinate,
}: CurrentLocationMarkerProps) {
  return <MapPin coordinate={coordinate} color={BrandColors.accent} />;
});
