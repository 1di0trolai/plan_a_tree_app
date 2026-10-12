import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useApp } from '@/store/AppStore';

type IconName = ComponentProps<typeof Ionicons>['name'];

const ICONS: Record<string, { active: IconName; inactive: IconName }> = {
  garden: { active: 'leaf', inactive: 'leaf-outline' },
  inventory: { active: 'file-tray-full', inactive: 'file-tray-full-outline' },
  camera: { active: 'camera', inactive: 'camera-outline' },
  battle: { active: 'shield', inactive: 'shield-outline' },
  profile: { active: 'person', inactive: 'person-outline' },
};

export default function TabLayout() {
  const { ready, state } = useApp();

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5F3EB' }}>
        <ActivityIndicator color="#246B4A" size="large" />
      </View>
    );
  }

  if (!state.auth.loggedIn) return <Redirect href="/" />;

  return (
    <Tabs
      initialRouteName="garden"
      screenOptions={({ route }) => ({
        headerShown: false,
        sceneStyle: { backgroundColor: '#F5F3EB' },
        tabBarActiveTintColor: '#246B4A',
        tabBarInactiveTintColor: '#88928C',
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '800',
          marginTop: 1,
        },
        tabBarStyle: {
          minHeight: 74,
          paddingTop: 8,
          paddingBottom: 8,
          borderTopWidth: 1,
          borderTopColor: '#E1E4DD',
          backgroundColor: '#FFFDF8',
          shadowColor: '#173C2B',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.06,
          shadowRadius: 14,
          elevation: 12,
        },
        tabBarIcon: ({ color, focused, size }) => {
          const icon = ICONS[route.name] ?? ICONS.garden;
          return <Ionicons name={focused ? icon.active : icon.inactive} color={color} size={size} />;
        },
      })}
    >
      <Tabs.Screen name="garden" options={{ title: 'Vườn' }} />
      <Tabs.Screen name="inventory" options={{ title: 'Kho đồ' }} />
      <Tabs.Screen
        name="camera"
        options={{
          title: 'Camera',
          tabBarLabel: 'Check-in',
          tabBarButton: ({ accessibilityState, onPress }) => (
            <Pressable
              accessibilityLabel="Mở Camera check-in"
              accessibilityRole="button"
              accessibilityState={accessibilityState}
              onPress={onPress}
              style={({ pressed }) => ({
                alignItems: 'center',
                flex: 1,
                justifyContent: 'center',
                opacity: pressed ? 0.78 : 1,
              })}>
              <View
                style={{
                  alignItems: 'center',
                  backgroundColor: '#246B4A',
                  borderColor: '#FFFDF8',
                  borderRadius: 28,
                  borderWidth: 5,
                  elevation: 10,
                  height: 58,
                  justifyContent: 'center',
                  marginTop: -24,
                  shadowColor: '#173C2B',
                  shadowOffset: { width: 0, height: 5 },
                  shadowOpacity: 0.24,
                  shadowRadius: 9,
                  width: 58,
                }}>
                <Ionicons name="camera" color="#FFFFFF" size={27} />
              </View>
              <Text style={{ color: '#246B4A', fontSize: 10, fontWeight: '800', marginTop: 1 }}>
                Check-in
              </Text>
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen
        name="battle"
        options={{
          title: 'Battle',
          tabBarBadge: 'Sắp có',
          tabBarBadgeStyle: { backgroundColor: '#F1B94A', color: '#24352E', fontSize: 8 },
        }}
      />
      <Tabs.Screen name="profile" options={{ title: 'Hồ sơ' }} />
    </Tabs>
  );
}
