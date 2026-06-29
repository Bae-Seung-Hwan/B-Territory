import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TABS: {
  name: string;
  title: string;
  icon: IoniconName;
  iconFocused: IoniconName;
}[] = [
  { name: 'mission', title: '미션', icon: 'flag-outline', iconFocused: 'flag' },
  { name: 'chat', title: '채팅', icon: 'chatbubbles-outline', iconFocused: 'chatbubbles' },
  { name: 'map', title: '지도', icon: 'map-outline', iconFocused: 'map' },
  { name: 'ranking', title: '랭킹', icon: 'trophy-outline', iconFocused: 'trophy' },
  { name: 'profile', title: '내정보', icon: 'person-outline', iconFocused: 'person' },
];

export default function MainLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0A0A0F',
          borderTopColor: '#1A1A2E',
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: '#208AEF',
        tabBarInactiveTintColor: '#555',
      }}
    >
      {TABS.map(({ name, title, icon, iconFocused }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons name={focused ? iconFocused : icon} size={size} color={color} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
