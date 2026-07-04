// Log scenario route /log-scenario — renders the LogScenarioSheet inline
// underneath the WaylyHeader + BackHeader so the brand banner and back chip
// stay visible. We hold a "dirty" flag from the sheet so the route can swap
// the back action for a discard-confirm dialog.
import React, { useCallback, useState } from 'react';
import { Alert, BackHandler, Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import BackHeader from '../src/components/BackHeader';
import { EmptyState } from '../src/components/Screen';
import { LogScenarioSheet } from '../src/components/LogScenarioSheet';
import { useParticipants } from '../src/context/ParticipantsContext';
import type { ColorPalette } from '../src/lib/theme';
import { useThemedStyles } from '../src/hooks/useThemedStyles';

export default function LogScenarioRoute() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { active } = useParticipants();
  const [dirty, setDirty] = useState(false);

  const goBack = useCallback(() => {
    if (router.canGoBack && router.canGoBack()) return router.back();
    router.replace('/timeline' as any);
  }, [router]);

  const onBackPressed = useCallback(() => {
    if (!dirty) { goBack(); return; }
    Alert.alert(
      'Discard this entry?',
      "You have started capturing a scenario. If you go back now your draft will be cleared.",
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: goBack },
      ],
    );
  }, [dirty, goBack]);

  // Intercept Android hardware-back when the form is dirty.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (!dirty) return false; // let RN handle it (navigate back)
        onBackPressed();
        return true; // we will handle it via the Alert
      });
      return () => sub.remove();
    }, [dirty, onBackPressed]),
  );

  if (!active) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <BackHeader title="Log a Scenario" onBack={goBack} />
        <EmptyState
          icon="people-outline"
          title="No participant selected"
          body="Choose or add a participant first."
          cta={{ label: 'Participants', onPress: () => router.push('/participants' as any) }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <BackHeader title="Log a Scenario" onBack={onBackPressed} />
      <LogScenarioSheet
        inline
        visible
        participantId={active.id}
        participantName={active.first_name}
        onDirtyChange={setDirty}
        onClose={goBack}
        onLogged={() => router.replace('/timeline' as any)}
      />
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.background },
  });
}
