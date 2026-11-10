/** Điều phối giao dịch thú nuôi, cửa hàng, quà và hòm thư qua cùng biên lưu bền vững; giữ ý định đang chờ để thử lại mà không cộng/trừ tài nguyên hai lần. */

import type { RefObject } from 'react';
import { t } from '../i18n/core';
import type { AuthEnvelope } from '../services/accountAuth';
import type { AppState, DailyPetPack } from '../types/app';
import type { CloudStorage } from './cloudStorage';
import type { StoredUserData } from './storageLifecycle';
import { revealDailyPack } from './journeyActions';
import {
  consumePetFood, quickFeedPet as consumeQuickFood, sellPetCopies as sellCopies, upgradePet as evolvePet,
  type PetTransactionInput, type SellPetCopiesInput, type UpgradePetInput,
  type FeedPetInput, type QuickFeedPetInput,
} from './petActions';
import {
  claimDailyLogin, purchaseFood as buyFood,
  type FoodPurchaseInput, type LoginRewardResult,
} from './economyActions';
import { syncLoginVisit as syncVisit, readMail, readAllMail, claimMail as receiveMail,
  claimAllMail as receiveAllMail, deleteMail as removeMail, deleteAllMail as removeAllMail } from './loginMailbox';

export type PurchaseResult = { ok: true; message: string }
  | { ok: false; message: string; retryable?: boolean };
export type ClaimLoginResult = { ok: true; result: LoginRewardResult }
  | { ok: false; message: string; retryable?: boolean };
export type PetTransactionResult = PurchaseResult;
export type RewardIntent = { key: string; result?: LoginRewardResult };

/** Các cổng lưu/phiên do AppProvider quản lý; giao dịch không tự đổi tài khoản hay lập lịch đồng bộ. */
interface EconomyRuntime {
  ready: boolean;
  stateRef: RefObject<AppState>;
  commit: (update: (current: AppState) => AppState) => void;
  persistNow: () => Promise<void>;
  persistSnapshot: (state: AppState) => Promise<void>;
  resetting: RefObject<boolean>;
  economySession: RefObject<number>;
  purchaseIntent: RefObject<FoodPurchaseInput | null>;
  petIntent: RefObject<PetTransactionInput | null>;
  rewardIntent: RefObject<RewardIntent | null>;
  rewardWrite: RefObject<Promise<PurchaseResult> | null>;
  setPendingFoodPurchase: (input: FoodPurchaseInput | null) => void;
  setPendingPetTransaction: (input: PetTransactionInput | null) => void;
  setPendingRewardAction: (pending: boolean) => void;
  cloud: RefObject<CloudStorage | null>;
  session: RefObject<AuthEnvelope | null>;
  persistedRecord: RefObject<StoredUserData | null>;
  setState: (state: AppState) => void;
}

function economyTransactions({
  ready, stateRef, commit, persistNow, persistSnapshot, resetting, economySession,
  purchaseIntent, petIntent, rewardIntent, rewardWrite,
  setPendingFoodPurchase, setPendingPetTransaction, setPendingRewardAction,
  cloud, session, persistedRecord, setState,
}: EconomyRuntime) {
  const openDailyPack = (packId: string): DailyPetPack | null => {
    if (!ready || !stateRef.current.auth.loggedIn) throw new Error('Hãy đăng nhập để nhận quà.');
    if (petIntent.current || purchaseIntent.current
      || (rewardIntent.current && rewardIntent.current.key !== `pack:${packId}`)) {
      throw new Error('Hãy hoàn tất lưu giao dịch đang chờ trước khi mở thẻ.');
    }
    const { state: next, pack } = revealDailyPack(stateRef.current, packId);
    commit(() => next);
    if (pack) {
      rewardIntent.current = { key: `pack:${packId}` };
      setPendingRewardAction(true);
    }
    return pack;
  };

  const transactPet = async (input: PetTransactionInput): Promise<PetTransactionResult> => {
    const session = economySession.current;
    let message: string;
    try {
      if (!ready || !stateRef.current.auth.loggedIn) throw new Error('Hãy đăng nhập để quản lý thú nuôi.');
      if (rewardIntent.current) throw new Error('Hãy hoàn tất lưu quà đang chờ.');
      if (purchaseIntent.current) throw new Error('Hãy hoàn tất lưu đơn mua đồ trước đó.');
      if (petIntent.current && petIntent.current.requestId !== input.requestId) {
        throw new Error('Hãy hoàn tất lưu giao dịch thú nuôi trước đó.');
      }
      // The pure transition checks matching intent as well as the request ID.
      // Failed writes retry the original receipt instead of spending or selling twice.
      const transition = input.kind === 'sell' ? sellCopies(stateRef.current, input)
        : input.kind === 'upgrade' ? evolvePet(stateRef.current, input)
        : input.kind === 'feed' ? consumePetFood(stateRef.current, input)
        : consumeQuickFood(stateRef.current, input);
      commit(() => transition.state);
      petIntent.current = { ...input };
      setPendingPetTransaction(petIntent.current);
      message = transition.message;
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Chưa thể quản lý thú nuôi.' };
    }
    try {
      await persistNow();
      if (petIntent.current?.requestId === input.requestId) {
        petIntent.current = null;
        setPendingPetTransaction(null);
      }
      if (session !== economySession.current || resetting.current || !stateRef.current.auth.loggedIn) {
        return { ok: false, message: 'Phiên sử dụng đã thay đổi.' };
      }
      return { ok: true, message };
    } catch {
      if (session !== economySession.current || resetting.current || !stateRef.current.auth.loggedIn) {
        return { ok: false, message: 'Phiên sử dụng đã thay đổi.' };
      }
      return { ok: false, retryable: true,
        message: 'Chưa lưu được giao dịch thú nuôi. Thử lưu lại để hoàn tất; không trừ tài nguyên hay bán thêm lần nữa.' };
    }
  };

  const sellPetCopies = (input: SellPetCopiesInput) => transactPet({ ...input, kind: 'sell' });
  const upgradePet = (input: UpgradePetInput) => transactPet({ ...input, kind: 'upgrade' });
  const feedPet = (input: FeedPetInput) => transactPet({ ...input, kind: 'feed' });
  const quickFeedPet = (input: QuickFeedPetInput) => transactPet({ ...input, kind: 'quick-feed' });

  const purchaseFood = async (input: FoodPurchaseInput): Promise<PurchaseResult> => {
    const session = economySession.current;
    try {
      if (!ready || !stateRef.current.auth.loggedIn) throw new Error('Hãy đăng nhập để mở cửa hàng.');
      if (rewardIntent.current) throw new Error('Hãy hoàn tất lưu quà đang chờ.');
      if (petIntent.current) throw new Error('Hãy hoàn tất lưu giao dịch thú nuôi trước đó.');
      if (purchaseIntent.current && purchaseIntent.current.requestId !== input.requestId) {
        throw new Error('Hãy hoàn tất lưu đơn mua trước đó.');
      }
      // A receipt is committed synchronously. Retrying the same request after a
      // failed disk write saves that receipt, never debits the wallet again.
      commit((current) => buyFood(current, input).state);
      purchaseIntent.current = { ...input };
      setPendingFoodPurchase(purchaseIntent.current);
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Chưa thể mua thức ăn.' };
    }
    try {
      await persistNow();
      if (purchaseIntent.current?.requestId === input.requestId) {
        purchaseIntent.current = null;
        setPendingFoodPurchase(null);
      }
      if (session !== economySession.current || resetting.current || !stateRef.current.auth.loggedIn) {
        return { ok: false, message: 'Phiên sử dụng đã thay đổi.' };
      }
      return { ok: true, message: t('Đã thêm {count} gói vào kho.', { count: input.quantity }) };
    } catch {
      return { ok: false, retryable: true, message: 'Chưa lưu được giao dịch. Thử lưu lại để hoàn tất, không trừ vàng lần nữa.' };
    }
  };

  const finishRewardWrite = (): Promise<PurchaseResult> => {
    if (rewardWrite.current) return rewardWrite.current;
    const session = economySession.current;
    const intent = rewardIntent.current;
    const write = (async (): Promise<PurchaseResult> => {
      try {
        await persistNow();
        if (rewardIntent.current === intent) {
          rewardIntent.current = null;
          setPendingRewardAction(false);
        }
        if (session !== economySession.current || resetting.current || !stateRef.current.auth.loggedIn) {
          return { ok: false, message: 'Phiên sử dụng đã thay đổi.' };
        }
        return { ok: true, message: 'Đã lưu.' };
      } catch {
        if (session !== economySession.current || resetting.current || !stateRef.current.auth.loggedIn) {
          return { ok: false, message: 'Phiên sử dụng đã thay đổi.' };
        }
        return { ok: false, retryable: true, message: 'Chưa lưu được quà. Thử lưu lại; quà không được cộng trùng.' };
      }
    })();
    rewardWrite.current = write;
    void write.then(() => { if (rewardWrite.current === write) rewardWrite.current = null; });
    return write;
  };

  const transactReward = async (key: string,
    transition: (current: AppState) => { state: AppState; result?: LoginRewardResult },
  ): Promise<PurchaseResult & { result?: LoginRewardResult }> => {
    let result: LoginRewardResult | undefined;
    try {
      if (!ready || !stateRef.current.auth.loggedIn) throw new Error('Hãy đăng nhập để nhận quà.');
      if (purchaseIntent.current || petIntent.current) throw new Error('Hãy hoàn tất lưu giao dịch đang chờ.');
      if (rewardIntent.current && rewardIntent.current.key !== key) throw new Error('Hãy hoàn tất lưu quà đang chờ.');
      if (!rewardIntent.current) {
        const next = transition(stateRef.current);
        result = next.result;
        if (next.state === stateRef.current) return { ok: true, message: 'Đã lưu.', result };
        commit(() => next.state);
        rewardIntent.current = { key, result };
        setPendingRewardAction(true);
      } else result = rewardIntent.current.result;
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Chưa thể xử lý quà.' };
    }
    return { ...await finishRewardWrite(), result };
  };

  const retryRewardAction = (): Promise<PurchaseResult> => {
    if (!ready || resetting.current || !stateRef.current.auth.loggedIn) {
      return Promise.resolve({ ok: false, message: 'Hãy đăng nhập để tiếp tục lưu.' });
    }
    return rewardIntent.current ? finishRewardWrite() : Promise.resolve({ ok: true, message: 'Đã lưu.' });
  };
  const syncLoginVisit = () => transactReward('visit', (current) => ({ state: syncVisit(current).state }));
  const claimLoginReward = async (giftId?: string): Promise<ClaimLoginResult> => {
    const response = await transactReward(`login:${giftId ?? 'next'}`, (current) => claimDailyLogin(current, new Date(), Math.random, giftId));
    return response.ok && response.result ? { ok: true, result: response.result }
      : response.ok ? { ok: false, message: 'Không tìm thấy hộp quà.' } : response;
  };
  const publisherMail = async (kind: 'read' | 'claim' | 'delete', ids: string[]): Promise<PurchaseResult> => {
    if (ids.length === 0) return { ok: true, message: 'Đã lưu.' };
    const controller = cloud.current; const epoch = economySession.current;
    if (!controller || !session.current || resetting.current || rewardIntent.current || petIntent.current || purchaseIntent.current)
      return { ok: false, message: 'Hãy đợi lưu thao tác hiện tại hoặc đăng nhập lại.' };
    const write = persistSnapshot(stateRef.current);
    resetting.current = true;
    try {
      await write;
      const record = await controller.mail({ [kind === 'claim' ? 'claimIds' : kind === 'read' ? 'readIds' : 'deleteIds']: ids });
      if (epoch !== economySession.current || cloud.current !== controller) throw new Error('Phiên sử dụng đã thay đổi.');
      persistedRecord.current = record; stateRef.current = record.state; setState(record.state);
      return { ok: true, message: 'Đã lưu.' };
    } catch (cause) { return { ok: false, message: cause instanceof Error ? cause.message : 'Chưa xử lý được thư. Hãy thử đồng bộ lại.' }; }
    finally { if (epoch === economySession.current) resetting.current = false; }
  };
  const singleMail = (kind: 'read' | 'claim' | 'delete', id: string) => {
    if (stateRef.current.mailbox.find(mail => mail.id === id)?.source === 'publisher') return publisherMail(kind, [id]);
    return transactReward(`${kind}:${id}`, current => ({ state: kind === 'read' ? readMail(current, id).state
      : kind === 'claim' ? receiveMail(current, id).state : removeMail(current, id).state }));
  };
  const allMail = async (kind: 'read' | 'claim' | 'delete'): Promise<PurchaseResult> => {
    const ids = stateRef.current.mailbox.filter(mail => mail.source === 'publisher' &&
      (kind === 'read' ? mail.readAt === null : kind === 'claim' ? mail.claimedAt === null && mail.attachments.length > 0
        : mail.attachments.length === 0 || mail.claimedAt !== null)).map(mail => mail.id);
    const local = await transactReward(`mailbox:${kind}-all`, current => {
      // Existing local daily/streak letters keep their original durable path;
      // publisher gifts are credited only by the SQL transaction on the server.
      const system = { ...current, mailbox: current.mailbox.filter(mail => mail.source !== 'publisher') };
      const next = kind === 'read' ? readAllMail(system).state : kind === 'claim' ? receiveAllMail(system).state : removeAllMail(system).state;
      if (next === system) return { state: current };
      const publisher = current.mailbox.filter(mail => mail.source === 'publisher');
      return { state: publisher.length === 0 ? next : { ...next, mailbox: [...next.mailbox, ...publisher] } };
    });
    return local.ok ? publisherMail(kind, ids) : local;
  };
  const markMailRead = (id: string) => singleMail('read', id);
  const claimMail = (id: string) => singleMail('claim', id);
  const deleteMail = (id: string) => singleMail('delete', id);
  const markAllMailRead = () => allMail('read');
  const claimAllMail = () => allMail('claim');
  const deleteAllMail = () => allMail('delete');
  return {
    openDailyPack, feedPet, quickFeedPet, sellPetCopies, upgradePet, purchaseFood,
    claimLoginReward, syncLoginVisit, markMailRead, markAllMailRead,
    claimMail, claimAllMail, deleteMail, deleteAllMail, retryRewardAction,
  };
}

/** Chỉ mở cổng trạng thái khi người dùng gọi thao tác, không đọc ref trong lúc render. */
export function createEconomyTransactions(runtime: () => EconomyRuntime) {
  return {
    openDailyPack: (id: string) => economyTransactions(runtime()).openDailyPack(id),
    feedPet: (input: FeedPetInput) => economyTransactions(runtime()).feedPet(input),
    quickFeedPet: (input: QuickFeedPetInput) => economyTransactions(runtime()).quickFeedPet(input),
    sellPetCopies: (input: SellPetCopiesInput) => economyTransactions(runtime()).sellPetCopies(input),
    upgradePet: (input: UpgradePetInput) => economyTransactions(runtime()).upgradePet(input),
    purchaseFood: (input: FoodPurchaseInput) => economyTransactions(runtime()).purchaseFood(input),
    claimLoginReward: (id?: string) => economyTransactions(runtime()).claimLoginReward(id),
    syncLoginVisit: () => economyTransactions(runtime()).syncLoginVisit(),
    markMailRead: (id: string) => economyTransactions(runtime()).markMailRead(id),
    markAllMailRead: () => economyTransactions(runtime()).markAllMailRead(),
    claimMail: (id: string) => economyTransactions(runtime()).claimMail(id),
    claimAllMail: () => economyTransactions(runtime()).claimAllMail(),
    deleteMail: (id: string) => economyTransactions(runtime()).deleteMail(id),
    deleteAllMail: () => economyTransactions(runtime()).deleteAllMail(),
    retryRewardAction: () => economyTransactions(runtime()).retryRewardAction(),
  };
}
