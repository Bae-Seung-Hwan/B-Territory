import { Stack } from 'expo-router';

// (auth)/_layout.tsx와 같은 패턴 — 네이티브 헤더 없이 각 화면이 자체적으로 뒤로가기를 그린다.
export default function ProfileLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
