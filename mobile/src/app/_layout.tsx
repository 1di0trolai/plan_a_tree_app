import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { AppProvider, useApp } from '@/store/AppStore';

export { ErrorBoundary } from 'expo-router';

export default function RootLayout() {
  return (
    <AppProvider>
      <StatusBar style="dark" />
      <RootNavigator />
    </AppProvider>
  );
}

function RootNavigator() {
  const { ready, state } = useApp();
  if (!ready) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5F3EB' }}><ActivityIndicator color="#246B4A" size="large" /></View>;
  }
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#F5F3EB' },
        animation: 'fade',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Protected guard={state.auth.loggedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="ar-hunt" options={{ animation: 'slide_from_bottom', presentation: 'fullScreenModal' }} />
      </Stack.Protected>
    </Stack>
  );
}
