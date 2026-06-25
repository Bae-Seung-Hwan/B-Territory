import { Tabs } from 'expo-router';
import { Image } from 'react-native';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];

  return (
    <Tabs
      screenOptions={{
        // 1. 전체 탭바 배경색 및 활성화 색상 설정
        tabBarStyle: { backgroundColor: colors.background },
        tabBarActiveTintColor: colors.text, 
        // tabBarInactiveTintColor: 'gray', // 필요하다면 비활성화 색상도 지정 가능
        headerShown: false, // 상단 헤더가 필요 없다면 이 옵션을 켭니다.
      }}>
      
      {/* --- Home 탭 --- */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => (
            // 2. 템플릿 렌더링 모드 대신, style에 tintColor를 주어 색상이 자동 변하게 설정
            <Image
              source={require('@/assets/images/tabIcons/home.png')}
              style={{ width: 24, height: 24, tintColor: color }}
            />
          ),
        }}
      />

      {/* --- Explore 탭 --- */}
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Explore',
          tabBarIcon: ({ color }) => (
            <Image
              source={require('@/assets/images/tabIcons/explore.png')}
              style={{ width: 24, height: 24, tintColor: color }}
            />
          ),
        }}
      />
    </Tabs>
  );
}
