import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as Sharing from 'expo-sharing';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';
import {
  ParkingPlan,
  ParkingSession,
  StreakState,
  addMinutes,
  completeSession,
  createParkingSession,
  formatCountdown,
  getMascotMood,
  getProgress,
  getRemainingMs,
  proFeaturesForPlan,
  productIdForPlan,
} from './src/parkingSession';

const STORAGE_KEY = 'parking-reminder-timer-state-v1';
const PRIVACY_URL = 'https://laurenzpdm.github.io/parking-reminder-timer/privacy-policy.html';
const TERMS_URL = 'https://laurenzpdm.github.io/parking-reminder-timer/terms-of-use.html';

type SavedState = {
  session: ParkingSession | null;
  streak: StreakState;
  isPro: boolean;
  onboarded: boolean;
};

const initialState: SavedState = {
  session: null,
  streak: { ticketFreeDays: 0, sessionsCompleted: 0 },
  isPro: false,
  onboarded: false,
};

export default function App() {
  const [state, setState] = useState<SavedState>(initialState);
  const [duration, setDuration] = useState('90');
  const [spotNote, setSpotNote] = useState('Level 3, blue elevator');
  const [now, setNow] = useState(Date.now());
  const [selectedPlan, setSelectedPlan] = useState<ParkingPlan>('annual');
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const shareCardRef = useRef<View>(null);
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored) setState({ ...initialState, ...JSON.parse(stored) });
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => undefined);
  }, [state]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.04, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ]),
    ).start();
  }, [pulse]);

  const remainingMs = state.session ? getRemainingMs(state.session, now) : 0;
  const progress = state.session ? getProgress(state.session, now) : 0;
  const mascotMood = getMascotMood(state.session, now, state.streak);

  useEffect(() => {
    if (state.session && remainingMs === 0) {
      setState((current) => ({
        ...current,
        session: null,
        streak: completeSession(current.streak, Date.now()),
      }));
    }
  }, [remainingMs, state.session]);

  const proFeatures = useMemo(() => proFeaturesForPlan(selectedPlan), [selectedPlan]);

  async function startSession() {
    const requestedMinutes = Number.parseInt(duration, 10);
    const minutes = Number.isFinite(requestedMinutes) ? requestedMinutes : 90;
    const permission = await Location.requestForegroundPermissionsAsync().catch(() => ({ status: 'denied' }));
    let locationLabel = 'Current spot saved';

    if (permission.status === 'granted') {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
      if (position) {
        locationLabel = `${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)}`;
      }
    }

    const session = createParkingSession({
      durationMinutes: minutes,
      startedAt: Date.now(),
      note: spotNote.trim(),
      locationLabel,
    });

    await scheduleParkingReminder(session);
    setState((current) => ({ ...current, onboarded: true, session }));
  }

  async function scheduleParkingReminder(session: ParkingSession) {
    if (Platform.OS === 'web') return;
    const permissions = await Notifications.requestPermissionsAsync().catch(() => ({ status: 'denied' }));
    if (permissions.status !== 'granted') return;

    const triggerSeconds = Math.max(5, Math.floor((session.warningAt - Date.now()) / 1000));
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Parking timer almost done',
        body: 'Head back or extend your meter before the session ends.',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: triggerSeconds,
      },
    });
  }

  async function buySelectedPlan() {
    setBusy(true);
    const productId = productIdForPlan(selectedPlan);

    try {
      if (Platform.OS !== 'web' && process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY) {
        const Purchases = await import('react-native-purchases');
        Purchases.default.configure({ apiKey: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY });
        const offerings = await Purchases.default.getOfferings();
        const current = offerings.current;
        const pkg = current?.availablePackages.find((item) => item.product.identifier === productId);
        if (!pkg) throw new Error(`RevenueCat package missing for ${productId}`);
        await Purchases.default.purchasePackage(pkg);
      }

      setState((current) => ({ ...current, isPro: true }));
      setPaywallOpen(false);
    } catch (error) {
      Alert.alert('Purchase not completed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function restorePurchases() {
    setBusy(true);
    try {
      if (Platform.OS !== 'web' && process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY) {
        const Purchases = await import('react-native-purchases');
        Purchases.default.configure({ apiKey: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY });
        const customer = await Purchases.default.restorePurchases();
        const active = customer.entitlements.active.pro;
        setState((current) => ({ ...current, isPro: Boolean(active) }));
      } else {
        setState((current) => ({ ...current, isPro: true }));
      }
    } finally {
      setBusy(false);
    }
  }

  async function shareAchievement() {
    const message = `Ticket-free streak: ${state.streak.ticketFreeDays} days with Parking Reminder Timer`;

    try {
      if (shareCardRef.current && Platform.OS !== 'web') {
        const uri = await captureRef(shareCardRef, { format: 'png', quality: 1 });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share ticket-free streak' });
          return;
        }
      }
      await Share.share({ message });
    } catch {
      await Share.share({ message });
    }
  }

  function renderMainAction() {
    if (!state.session) {
      return (
        <View style={styles.setupPanel}>
          <Text style={styles.panelTitle}>Start in seconds</Text>
          <View style={styles.inputRow}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Meter time</Text>
              <TextInput
                keyboardType="number-pad"
                value={duration}
                onChangeText={setDuration}
                style={styles.input}
                accessibilityLabel="Parking duration minutes"
              />
            </View>
            <View style={styles.inputGroupWide}>
              <Text style={styles.label}>Spot note</Text>
              <TextInput value={spotNote} onChangeText={setSpotNote} style={styles.input} accessibilityLabel="Parking spot note" />
            </View>
          </View>
          <Pressable style={styles.primaryButton} onPress={startSession} accessibilityRole="button">
            <Text style={styles.primaryButtonText}>Start parking timer</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View style={styles.timerPanel}>
        <View style={styles.timerCircle}>
          <Text style={styles.timerLabel}>Time left</Text>
          <Text style={styles.timerText}>{formatCountdown(remainingMs)}</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        </View>
        <View style={styles.locationCard}>
          <Text style={styles.cardEyebrow}>Saved spot</Text>
          <Text style={styles.cardTitle}>{state.session.locationLabel}</Text>
          <Text style={styles.cardMeta}>{state.session.note || 'No note added'}</Text>
        </View>
        <View style={styles.actionRow}>
          <Pressable style={styles.secondaryButton} onPress={() => setState((current) => current.session ? { ...current, session: addMinutes(current.session, 10) } : current)}>
            <Text style={styles.secondaryButtonText}>+10 min</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => Alert.alert('Find car', state.session?.locationLabel ?? 'No location saved')}>
            <Text style={styles.secondaryButtonText}>Find car</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>Parking Reminder Timer</Text>
            <Text style={styles.title}>{state.onboarded ? 'Your meter is covered' : 'Never miss a meter again'}</Text>
          </View>
          <Animated.View style={[styles.mascot, { transform: [{ scale: pulse }] }]}>
            <View style={[styles.mascotHead, mascotMood === 'urgent' && styles.mascotUrgent]} />
            <View style={styles.mascotBody} />
            <Text style={styles.mascotFace}>{mascotMood === 'urgent' ? '!' : mascotMood === 'proud' ? '^' : 'o'}</Text>
          </Animated.View>
        </View>

        {renderMainAction()}

        <View style={styles.statsGrid}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{state.streak.ticketFreeDays}</Text>
            <Text style={styles.statLabel}>ticket-free days</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{state.streak.sessionsCompleted}</Text>
            <Text style={styles.statLabel}>sessions watched</Text>
          </View>
        </View>

        <View ref={shareCardRef} collapsable={false} style={styles.shareCard}>
          <Text style={styles.shareEyebrow}>Parking win</Text>
          <Text style={styles.shareTitle}>Ticket-free streak</Text>
          <Text style={styles.shareNumber}>{state.streak.ticketFreeDays || 1} days</Text>
          <Text style={styles.shareCaption}>A small timer saved a stressful walk back.</Text>
        </View>

        <View style={styles.actionRow}>
          <Pressable style={styles.secondaryButton} onPress={shareAchievement}>
            <Text style={styles.secondaryButtonText}>Share streak</Text>
          </Pressable>
          <Pressable style={styles.proButton} onPress={() => setPaywallOpen(true)}>
            <Text style={styles.proButtonText}>{state.isPro ? 'Pro active' : 'Unlock Pro'}</Text>
          </Pressable>
        </View>

        {paywallOpen && (
          <View style={styles.paywall}>
            <Text style={styles.panelTitle}>Parking Pro</Text>
            <Text style={styles.paywallCopy}>Unlimited sessions, smarter reminders, and share-ready ticket-free wins.</Text>
            <View style={styles.planRow}>
              <PlanButton selected={selectedPlan === 'annual'} title="Annual" subtitle="7-day free trial" onPress={() => setSelectedPlan('annual')} />
              <PlanButton selected={selectedPlan === 'weekly'} title="Weekly" subtitle="No trial" onPress={() => setSelectedPlan('weekly')} />
            </View>
            {proFeatures.map((feature) => (
              <Text key={feature} style={styles.feature}>- {feature}</Text>
            ))}
            <Pressable disabled={busy} style={styles.primaryButton} onPress={buySelectedPlan}>
              <Text style={styles.primaryButtonText}>{busy ? 'Working...' : selectedPlan === 'annual' ? 'Start 7-day free trial' : 'Continue weekly'}</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={restorePurchases}>
              <Text style={styles.link}>Restore purchases</Text>
            </Pressable>
            <View style={styles.legalRow}>
              <Text style={styles.link} onPress={() => Linking.openURL(TERMS_URL)}>Terms</Text>
              <Text style={styles.link} onPress={() => Linking.openURL(PRIVACY_URL)}>Privacy</Text>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function PlanButton({ selected, title, subtitle, onPress }: { selected: boolean; title: string; subtitle: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.planButton, selected && styles.planButtonSelected]}>
      <Text style={[styles.planTitle, selected && styles.planTitleSelected]}>{title}</Text>
      <Text style={[styles.planSubtitle, selected && styles.planTitleSelected]}>{subtitle}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f7fbff' },
  container: { padding: 20, gap: 18 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16 },
  kicker: { color: '#25787f', fontSize: 13, fontWeight: '700', marginBottom: 6 },
  title: { color: '#102f3a', fontSize: 34, fontWeight: '800', lineHeight: 38, maxWidth: 260 },
  mascot: { width: 82, height: 112, alignItems: 'center', justifyContent: 'flex-start' },
  mascotHead: { width: 58, height: 58, borderRadius: 8, backgroundColor: '#ffe08a', borderWidth: 3, borderColor: '#102f3a' },
  mascotUrgent: { backgroundColor: '#ffb15c' },
  mascotBody: { width: 34, height: 46, backgroundColor: '#28a6a2', borderRadius: 8, marginTop: -2 },
  mascotFace: { position: 'absolute', top: 17, color: '#102f3a', fontSize: 24, fontWeight: '900' },
  setupPanel: { backgroundColor: '#ffffff', borderRadius: 8, padding: 16, gap: 14, shadowColor: '#0d3040', shadowOpacity: 0.08, shadowRadius: 18 },
  timerPanel: { backgroundColor: '#ffffff', borderRadius: 8, padding: 16, alignItems: 'center', gap: 14, shadowColor: '#0d3040', shadowOpacity: 0.08, shadowRadius: 18 },
  panelTitle: { color: '#102f3a', fontSize: 22, fontWeight: '800' },
  inputRow: { flexDirection: 'row', gap: 12 },
  inputGroup: { flex: 0.7, gap: 6 },
  inputGroupWide: { flex: 1.3, gap: 6 },
  label: { color: '#5c7180', fontSize: 12, fontWeight: '700' },
  input: { backgroundColor: '#f1f7f8', borderColor: '#d5e8ea', borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, color: '#102f3a', fontSize: 16 },
  primaryButton: { backgroundColor: '#102f3a', borderRadius: 8, paddingVertical: 15, alignItems: 'center' },
  primaryButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  timerCircle: { width: 230, height: 230, borderRadius: 115, borderWidth: 14, borderColor: '#dff3f1', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fbffff' },
  timerLabel: { color: '#5c7180', fontSize: 13, fontWeight: '700' },
  timerText: { color: '#102f3a', fontSize: 44, fontWeight: '900', marginTop: 4 },
  progressTrack: { width: 150, height: 8, borderRadius: 4, backgroundColor: '#d9ecee', marginTop: 16, overflow: 'hidden' },
  progressFill: { height: 8, backgroundColor: '#28a6a2' },
  locationCard: { width: '100%', backgroundColor: '#f4f9f9', borderRadius: 8, padding: 14, gap: 4 },
  cardEyebrow: { color: '#25787f', fontSize: 12, fontWeight: '800' },
  cardTitle: { color: '#102f3a', fontSize: 17, fontWeight: '800' },
  cardMeta: { color: '#5c7180', fontSize: 14 },
  actionRow: { flexDirection: 'row', gap: 12 },
  secondaryButton: { flex: 1, borderRadius: 8, backgroundColor: '#e5f2f3', paddingVertical: 13, alignItems: 'center' },
  secondaryButtonText: { color: '#145e65', fontWeight: '800' },
  proButton: { flex: 1, borderRadius: 8, backgroundColor: '#ffc857', paddingVertical: 13, alignItems: 'center' },
  proButtonText: { color: '#102f3a', fontWeight: '900' },
  statsGrid: { flexDirection: 'row', gap: 12 },
  statBox: { flex: 1, backgroundColor: '#ffffff', borderRadius: 8, padding: 14 },
  statValue: { color: '#102f3a', fontSize: 28, fontWeight: '900' },
  statLabel: { color: '#5c7180', fontSize: 12, fontWeight: '700' },
  shareCard: { backgroundColor: '#12313b', borderRadius: 8, padding: 20, gap: 6 },
  shareEyebrow: { color: '#ffc857', fontSize: 12, fontWeight: '800' },
  shareTitle: { color: '#ffffff', fontSize: 22, fontWeight: '900' },
  shareNumber: { color: '#90eee7', fontSize: 48, fontWeight: '900' },
  shareCaption: { color: '#d7edf0', fontSize: 14 },
  paywall: { backgroundColor: '#ffffff', borderRadius: 8, padding: 16, gap: 12, shadowColor: '#0d3040', shadowOpacity: 0.08, shadowRadius: 18 },
  paywallCopy: { color: '#5c7180', fontSize: 15, lineHeight: 21 },
  planRow: { flexDirection: 'row', gap: 10 },
  planButton: { flex: 1, borderRadius: 8, borderWidth: 1, borderColor: '#d5e8ea', padding: 12, backgroundColor: '#f7fbff' },
  planButtonSelected: { borderColor: '#102f3a', backgroundColor: '#e8f8f6' },
  planTitle: { color: '#102f3a', fontSize: 16, fontWeight: '900' },
  planSubtitle: { color: '#5c7180', fontSize: 12, fontWeight: '700', marginTop: 2 },
  planTitleSelected: { color: '#102f3a' },
  feature: { color: '#334b55', fontSize: 14, lineHeight: 20 },
  link: { color: '#25787f', fontSize: 14, fontWeight: '800', textAlign: 'center', paddingVertical: 4 },
  legalRow: { flexDirection: 'row', justifyContent: 'center', gap: 28 },
});
