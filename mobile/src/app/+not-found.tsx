import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function NotFoundScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.card}>
        <View style={styles.icon}>
          <Ionicons name="leaf-outline" size={34} color="#246B4A" />
        </View>
        <Text style={styles.title}>Lối này chưa mọc cây</Text>
        <Text style={styles.copy}>Màn hình bạn tìm chưa tồn tại trong phiên bản PAT hiện tại.</Text>
        <Link href="/" asChild>
          <Pressable style={styles.button} accessibilityRole="button">
            <Text style={styles.buttonText}>Về trang bắt đầu</Text>
          </Pressable>
        </Link>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F5F3EB', justifyContent: 'center', padding: 24 },
  card: { alignItems: 'center', padding: 28, borderRadius: 28, backgroundColor: '#FFFDF8' },
  icon: { width: 68, height: 68, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5F2E6' },
  title: { marginTop: 18, color: '#1D3028', fontSize: 24, fontWeight: '900' },
  copy: { marginTop: 8, color: '#68756F', fontSize: 15, lineHeight: 22, textAlign: 'center' },
  button: { marginTop: 22, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 16, backgroundColor: '#246B4A' },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});
