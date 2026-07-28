import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TABS: {
  name: 'spots' | 'chat' | 'map' | 'ranking' | 'profile';
  icon: IoniconName;
  iconFocused: IoniconName;
}[] = [
  { name: 'spots', icon: 'list-outline', iconFocused: 'list' },
  { name: 'chat', icon: 'chatbubbles-outline', iconFocused: 'chatbubbles' },
  { name: 'map', icon: 'map-outline', iconFocused: 'map' },
  { name: 'ranking', icon: 'trophy-outline', iconFocused: 'trophy' },
  { name: 'profile', icon: 'person-outline', iconFocused: 'person' },
];

export default function MainLayout() {
  const { t } = useTranslation();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: BrandColors.background,
          borderTopColor: BrandColors.surface,
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: BrandColors.accent,
        tabBarInactiveTintColor: '#555',
      }}
    >
      {TABS.map(({ name, icon, iconFocused }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title: t(`tabs.${name}`),
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons name={focused ? iconFocused : icon} size={size} color={color} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
