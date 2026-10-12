import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '@/store/AppStore';

type AuthMode = 'login' | 'register' | 'forgot';

const isIdentityValid = (value: string) => {
  const normalized = value.trim().replace(/[\s.-]/g, '');
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) || /^(?:\+?84|0)\d{9}$/.test(normalized);
};

export default function AuthScreen() {
  const { ready, state, login, register, forgotPassword } = useApp();
  const [mode, setMode] = useState<AuthMode>('login');
  const [name, setName] = useState('');
  const [identity, setIdentity] = useState('demo@pat.vn');
  const [password, setPassword] = useState('123456');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (ready && state.auth.loggedIn) router.replace('/garden');
  }, [ready, state.auth.loggedIn]);

  const switchMode = (nextMode: AuthMode) => {
    setMessage(null);
    setMode(nextMode);
  };

  const heading = useMemo(() => {
    if (mode === 'register') return { eyebrow: 'BẮT ĐẦU HÀNH TRÌNH', title: 'Tạo khu vườn PAT', copy: 'Tạo tài khoản mẫu để bắt đầu theo dõi những người bạn xanh.' };
    if (mode === 'forgot') return { eyebrow: 'KHÔI PHỤC TÀI KHOẢN', title: 'Quên mật khẩu?', copy: 'PAT sẽ mô phỏng việc gửi hướng dẫn đến email của bạn.' };
    return { eyebrow: 'CHÀO NGƯỜI CHĂM CÂY', title: 'Mừng bạn trở lại!', copy: 'Khu vườn nhỏ đang chờ bạn check-in hôm nay.' };
  }, [mode]);

  const submit = async () => {
    setMessage(null);
    if (!isIdentityValid(identity)) {
      setMessage({ type: 'error', text: 'Hãy nhập email hoặc số điện thoại hợp lệ.' });
      return;
    }
    if (mode !== 'forgot' && password.length < 6) {
      setMessage({ type: 'error', text: 'Mật khẩu cần ít nhất 6 ký tự.' });
      return;
    }
    if (mode === 'register' && name.trim().length < 2) {
      setMessage({ type: 'error', text: 'Tên hiển thị cần ít nhất 2 ký tự.' });
      return;
    }
    if (mode === 'register' && confirmPassword !== password) {
      setMessage({ type: 'error', text: 'Mật khẩu nhập lại chưa khớp.' });
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'forgot') {
        const result = await Promise.resolve(forgotPassword(identity));
        setMessage({ type: result.ok ? 'success' : 'error', text: result.message });
        return;
      }
      if (mode === 'register') {
        const result = await Promise.resolve(register(name.trim(), identity.trim(), password));
        if (!result.ok) {
          setMessage({ type: 'error', text: result.message ?? 'Chưa thể tạo tài khoản mẫu.' });
          return;
        }
        switchMode('login');
        setMessage({ type: 'success', text: 'Đã tạo tài khoản mẫu. Bạn có thể đăng nhập ngay.' });
        return;
      }
      const result = await Promise.resolve(login(identity.trim(), password, remember));
      if (!result.ok) {
        setMessage({ type: 'error', text: result.message ?? 'Không thể đăng nhập.' });
        return;
      }
      router.replace('/garden');
    } finally {
      setSubmitting(false);
    }
  };

  if (!ready) {
    return (
      <View style={styles.loading}>
        <View style={styles.loadingLogo}><Ionicons name="leaf" size={34} color="#246B4A" /></View>
        <ActivityIndicator color="#246B4A" />
        <Text style={styles.loadingText}>Đang mở khu vườn...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <LinearGradient colors={['#174A35', '#2F7854']} style={styles.hero}>
            <View style={styles.brandRow}>
              <View style={styles.brandMark}><Ionicons name="leaf" size={22} color="#214C37" /></View>
              <Text style={styles.brand}>PAT</Text>
            </View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroEyebrow}>PLANT ADVENTURE TRACKER</Text>
              <Text style={styles.heroTitle}>Mỗi chiếc lá đều có một câu chuyện.</Text>
              <Text style={styles.heroText}>Theo dõi cây mỗi ngày và khám phá những người bạn nhỏ quanh khu vườn.</Text>
            </View>
            <View style={styles.heroPlant}>
              <View style={[styles.leaf, styles.leafLeft]} />
              <View style={[styles.leaf, styles.leafRight]} />
              <View style={styles.stem} />
              <View style={styles.pot}><Text style={styles.potFace}>• ᴗ •</Text></View>
            </View>
          </LinearGradient>

          <View style={styles.card}>
            {mode !== 'login' && (
              <Pressable onPress={() => switchMode('login')} style={styles.backButton} accessibilityRole="button">
                <Ionicons name="arrow-back" size={18} color="#246B4A" />
                <Text style={styles.backText}>Đăng nhập</Text>
              </Pressable>
            )}
            <Text style={styles.eyebrow}>{heading.eyebrow}</Text>
            <Text style={styles.title}>{heading.title}</Text>
            <Text style={styles.copy}>{heading.copy}</Text>

            {mode === 'register' && (
              <Field icon="person-outline" label="Tên của bạn">
                <TextInput value={name} onChangeText={setName} style={styles.input} placeholder="Ví dụ: Minh Anh" placeholderTextColor="#99A19D" autoCapitalize="words" />
              </Field>
            )}

            <Field icon="mail-outline" label={mode === 'login' ? 'Email hoặc số điện thoại' : 'Email'}>
              <TextInput
                value={identity}
                onChangeText={setIdentity}
                style={styles.input}
                placeholder="ban@example.com"
                placeholderTextColor="#99A19D"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="username"
              />
            </Field>

            {mode !== 'forgot' && (
              <Field icon="lock-closed-outline" label="Mật khẩu">
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  style={[styles.input, styles.passwordInput]}
                  placeholder="Tối thiểu 6 ký tự"
                  placeholderTextColor="#99A19D"
                  secureTextEntry={!showPassword}
                  textContentType={mode === 'login' ? 'password' : 'newPassword'}
                />
                <Pressable onPress={() => setShowPassword((value) => !value)} hitSlop={10} accessibilityLabel={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={21} color="#68756F" />
                </Pressable>
              </Field>
            )}

            {mode === 'register' && (
              <Field icon="shield-checkmark-outline" label="Nhập lại mật khẩu">
                <TextInput value={confirmPassword} onChangeText={setConfirmPassword} style={styles.input} placeholder="Nhập lại mật khẩu" placeholderTextColor="#99A19D" secureTextEntry={!showPassword} textContentType="newPassword" />
              </Field>
            )}

            {mode === 'login' && (
              <View style={styles.optionsRow}>
                <View style={styles.rememberRow}>
                  <Switch value={remember} onValueChange={setRemember} trackColor={{ false: '#D7DDD8', true: '#8BC59B' }} thumbColor={remember ? '#246B4A' : '#FFFFFF'} />
                  <Text style={styles.rememberText}>Ghi nhớ</Text>
                </View>
                <Pressable onPress={() => switchMode('forgot')} accessibilityRole="button"><Text style={styles.textButton}>Quên mật khẩu?</Text></Pressable>
              </View>
            )}

            {message && (
              <View style={[styles.message, message.type === 'error' ? styles.messageError : styles.messageSuccess]}>
                <Ionicons name={message.type === 'error' ? 'alert-circle-outline' : 'checkmark-circle-outline'} size={19} color={message.type === 'error' ? '#A94A45' : '#246B4A'} />
                <Text style={[styles.messageText, message.type === 'error' ? styles.messageTextError : styles.messageTextSuccess]}>{message.text}</Text>
              </View>
            )}

            <Pressable onPress={submit} disabled={submitting} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, submitting && styles.disabled]} accessibilityRole="button">
              {submitting ? <ActivityIndicator color="#FFFFFF" /> : <>
                <Text style={styles.primaryButtonText}>{mode === 'login' ? 'Vào khu vườn' : mode === 'register' ? 'Tạo tài khoản' : 'Gửi hướng dẫn'}</Text>
                <Ionicons name={mode === 'forgot' ? 'paper-plane-outline' : 'arrow-forward'} size={19} color="#FFFFFF" />
              </>}
            </Pressable>

            {mode === 'login' && (
              <>
                <View style={styles.divider}><View style={styles.dividerLine} /><Text style={styles.dividerText}>bản thử nghiệm</Text><View style={styles.dividerLine} /></View>
                <Text style={styles.demoHint}>Dùng <Text style={styles.demoStrong}>demo@pat.vn</Text> · mật khẩu <Text style={styles.demoStrong}>123456</Text></Text>
                <Pressable onPress={() => switchMode('register')} style={styles.registerLink} accessibilityRole="button">
                  <Text style={styles.registerText}>Chưa có tài khoản? <Text style={styles.textButton}>Tạo khu vườn mới</Text></Text>
                </Pressable>
              </>
            )}
          </View>

          <View style={styles.privacyRow}>
            <Ionicons name="phone-portrait-outline" size={16} color="#68756F" />
            <Text style={styles.privacyText}>Dữ liệu mẫu chỉ được lưu trên thiết bị của bạn.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ icon, label, children }: { icon: keyof typeof Ionicons.glyphMap; label: string; children: React.ReactNode }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.field}>
        <Ionicons name={icon} size={20} color="#68756F" />
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: '#F5F3EB' },
  scroll: { flexGrow: 1, paddingBottom: 28 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#F5F3EB' },
  loadingLogo: { width: 68, height: 68, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E4F1E4' },
  loadingText: { color: '#68756F', fontWeight: '700' },
  hero: { minHeight: 285, paddingHorizontal: 24, paddingTop: 22, overflow: 'hidden' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#D8EF76' },
  brand: { color: '#FFFFFF', fontSize: 23, fontWeight: '900', letterSpacing: 1 },
  heroCopy: { width: '70%', marginTop: 29, zIndex: 2 },
  heroEyebrow: { color: '#D8EF76', fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  heroTitle: { marginTop: 8, color: '#FFFFFF', fontSize: 30, lineHeight: 34, fontWeight: '900' },
  heroText: { marginTop: 10, color: '#D9E9DF', fontSize: 13, lineHeight: 19, fontWeight: '600' },
  heroPlant: { position: 'absolute', right: 15, bottom: -2, width: 125, height: 165, alignItems: 'center', justifyContent: 'flex-end' },
  pot: { width: 83, height: 65, borderTopLeftRadius: 13, borderTopRightRadius: 13, borderBottomLeftRadius: 26, borderBottomRightRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E9904A' },
  potFace: { marginTop: 5, color: '#613C2C', fontSize: 17, fontWeight: '900' },
  stem: { position: 'absolute', bottom: 62, width: 8, height: 75, borderRadius: 10, backgroundColor: '#78A958' },
  leaf: { position: 'absolute', bottom: 105, width: 58, height: 36, borderTopLeftRadius: 45, borderBottomRightRadius: 45, backgroundColor: '#A6D166' },
  leafLeft: { right: 61, transform: [{ rotate: '20deg' }] },
  leafRight: { left: 61, transform: [{ scaleX: -1 }, { rotate: '20deg' }], backgroundColor: '#7EB65E' },
  card: { marginTop: -18, marginHorizontal: 16, padding: 22, borderRadius: 28, backgroundColor: '#FFFDF8', shadowColor: '#173C2B', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.1, shadowRadius: 22, elevation: 6 },
  backButton: { minHeight: 40, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7 },
  backText: { color: '#246B4A', fontSize: 14, fontWeight: '800' },
  eyebrow: { color: '#438461', fontSize: 10, fontWeight: '900', letterSpacing: 1.25 },
  title: { marginTop: 5, color: '#1D3028', fontSize: 26, lineHeight: 31, fontWeight: '900' },
  copy: { marginTop: 7, marginBottom: 16, color: '#68756F', fontSize: 14, lineHeight: 20 },
  fieldWrap: { marginTop: 12 },
  label: { marginBottom: 7, color: '#33463D', fontSize: 13, fontWeight: '800' },
  field: { minHeight: 54, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: '#DCE2DD', borderRadius: 16, backgroundColor: '#F9FAF6' },
  input: { flex: 1, minHeight: 52, color: '#1D3028', fontSize: 15, fontWeight: '600' },
  passwordInput: { paddingRight: 4 },
  optionsRow: { marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rememberRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  rememberText: { color: '#52615A', fontSize: 13, fontWeight: '700' },
  textButton: { color: '#246B4A', fontSize: 13, fontWeight: '900' },
  message: { marginTop: 14, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 13 },
  messageError: { backgroundColor: '#FCE9E7' },
  messageSuccess: { backgroundColor: '#E7F4E8' },
  messageText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  messageTextError: { color: '#8E3F3A' },
  messageTextSuccess: { color: '#246B4A' },
  primaryButton: { minHeight: 55, marginTop: 18, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 17, backgroundColor: '#246B4A' },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  pressed: { opacity: 0.88, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.65 },
  divider: { marginTop: 19, flexDirection: 'row', alignItems: 'center', gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#E1E4DD' },
  dividerText: { color: '#919A95', fontSize: 11, fontWeight: '700' },
  demoHint: { marginTop: 13, color: '#68756F', fontSize: 12, textAlign: 'center' },
  demoStrong: { color: '#33463D', fontWeight: '900' },
  registerLink: { minHeight: 44, marginTop: 8, alignItems: 'center', justifyContent: 'center' },
  registerText: { color: '#68756F', fontSize: 13 },
  privacyRow: { marginTop: 17, paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  privacyText: { color: '#68756F', fontSize: 11, fontWeight: '600' },
});
