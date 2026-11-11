/** Cung cấp thao tác chăm cây và tùy chọn hồ sơ; mọi cập nhật đi qua commit của AppProvider. */
import { useCallback, useMemo } from 'react';
import type { CareEvent, Plant, PlantChatMessage, PlantJourney, Profile, Settings } from '../types/app';
import {
  addCareEvent, appendPlantChat, archivePlantJourney,
  createPlantJourney, recordPlantInspection, restorePlantJourney, updatePlantJourney,
  type CareEventInput, type ChatMessageInput, type CreateJourneyInput,
  type InspectionInput, type InspectionResult,
} from './journeyActions';
import type { MessageResult } from './petActions';
import type { AppRuntime } from './useAppRuntime';

export function usePlantActions({ state, stateRef, commit }: AppRuntime) {
  const activePlantIndex = Math.max(0, state.plants.findIndex((plant) => plant.id === state.activePlantId));
  const activePlant = state.plants[activePlantIndex] ?? null;

  const setActivePlantIndex = useCallback((index: number) => {
    commit((current) => {
      const safeIndex = Math.max(0, Math.min(Math.trunc(index), current.plants.length - 1));
      const plant = current.plants[safeIndex];
      return plant && plant.id !== current.activePlantId
        ? { ...current, activePlantId: plant.id }
        : current;
    });
  }, [commit]);

  const removePlant = useCallback((id: string): MessageResult => {
    const { state: next, result } = archivePlantJourney(stateRef.current, id);
    commit(() => next);
    return result;
  }, [commit, stateRef]);

  const restorePlant = useCallback((id: string): MessageResult => {
    try {
      const { state: next, result } = restorePlantJourney(stateRef.current, id);
      commit(() => next);
      return result;
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Chưa thể khôi phục cây.' };
    }
  }, [commit, stateRef]);

  const createJourney = useCallback((input: CreateJourneyInput): Plant => {
    const { state: next, plant } = createPlantJourney(stateRef.current, input);
    commit(() => next);
    return plant;
  }, [commit, stateRef]);

  const updateJourney = useCallback((plantId: string, updates: Partial<PlantJourney>): MessageResult => {
    try {
      commit((current) => updatePlantJourney(current, plantId, updates));
      return { ok: true, message: 'Đã cập nhật hành trình trồng cây.' };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Chưa thể cập nhật hành trình.' };
    }
  }, [commit]);

  const saveInspection = useCallback((input: InspectionInput): InspectionResult => {
    const { state: next, result } = recordPlantInspection(stateRef.current, input);
    commit(() => next);
    return result;
  }, [commit, stateRef]);

  const appendChatMessage = useCallback((input: ChatMessageInput): PlantChatMessage => {
    const { state: next, message } = appendPlantChat(stateRef.current, input);
    commit(() => next);
    return message;
  }, [commit, stateRef]);

  const recordCareEvent = useCallback((input: CareEventInput): CareEvent => {
    const { state: next, event } = addCareEvent(stateRef.current, input);
    commit(() => next);
    return event;
  }, [commit, stateRef]);

  const updateProfile = useCallback((updates: Partial<Profile>) => {
    commit((current) => ({
      ...current,
      profile: {
        ...current.profile,
        ...updates,
        name: updates.name?.trim() || current.profile.name,
        title: updates.title?.trim() || current.profile.title,
      },
    }));
  }, [commit]);

  const updateSetting = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    commit((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));
  }, [commit]);

  return useMemo(() => ({
    activePlant, setActivePlantIndex, removePlant, restorePlant, createJourney,
    updateJourney, saveInspection, appendChatMessage, recordCareEvent, updateProfile, updateSetting,
  }), [
    activePlant, setActivePlantIndex, removePlant, restorePlant, createJourney,
    updateJourney, saveInspection, appendChatMessage, recordCareEvent, updateProfile, updateSetting,
  ]);
}
