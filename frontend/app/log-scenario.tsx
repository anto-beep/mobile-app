// Log scenario screen — standalone route /log-scenario (in-tab capture).
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import BackHeader from '../src/components/BackHeader';
import { EmptyState } from '../src/components/Screen';
import { LogScenarioSheet } from '../src/components/LogScenarioSheet';
import { useParticipants } from '../src/context/ParticipantsContext';
import { Colors } from '../src/lib/theme';

export default function LogScenarioRoute() {
  const router = useRouter();
  const { active } = useParticipants();
  const [open, setOpen] = useState(true);
  if (!active) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <BackHeader title="Log scenario" />
        <EmptyState icon="people-outline" title="No participant selected" body="Choose or add a participant first." cta={{ label: 'Participants', onPress: () => router.push('/participants' as any) }} />
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <BackHeader title="Log scenario" />
      <LogScenarioSheet fullScreen visible={open} participantId={active.id} participantName={active.first_name} onClose={() => { setOpen(false); router.back(); }} onLogged={() => { setOpen(false); router.replace('/timeline' as any); }} />
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: Colors.bg } });
