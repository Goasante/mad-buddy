from pathlib import Path


def edit(path: str, replacements: list[tuple[str, str]]) -> None:
    p = Path(path)
    text = p.read_text()
    for old, new in replacements:
        count = text.count(old)
        if count != 1:
            raise SystemExit(f"{path}: expected exactly one match, found {count}: {old[:120]!r}")
        text = text.replace(old, new, 1)
    p.write_text(text)


edit("components/friends/friends-page.tsx", [
    (
        'import { haptic } from "@/lib/device/haptics";\n',
        'import { haptic } from "@/lib/device/haptics";\nimport { feedback as interactionFeedback } from "@/lib/feedback/feedback";\n'
    ),
    (
        '''      setWriting(false);
      setFeedback(result.message);

      if (result.ok) {''',
        '''      setWriting(false);
      setFeedback(result.message);
      if (!result.ok) interactionFeedback.error();

      if (result.ok) {'''
    ),
    (
        '''                    () => acceptFriendRequestAction(person.requestId ?? person.id),
                    () => promoteUserToFriend(person.id, `${person.displayName} is now your Muddy.`)''',
        '''                    () => acceptFriendRequestAction(person.requestId ?? person.id),
                    () => {
                      interactionFeedback.success();
                      promoteUserToFriend(person.id, `${person.displayName} is now your Muddy.`);
                    }'''
    ),
    (
        '''                      () => acceptFriendRequestAction(user.requestId ?? user.id),
                      () => promoteUserToFriend(user.id, `${user.displayName} is now your friend.`)''',
        '''                      () => acceptFriendRequestAction(user.requestId ?? user.id),
                      () => {
                        interactionFeedback.success();
                        promoteUserToFriend(user.id, `${user.displayName} is now your friend.`);
                      }'''
    ),
    (
        '''            () => {
              updateUserStatus(user.id, "sent", `Muddy request sent to ${user.displayName}.`);
              setAddOpen(false);''',
        '''            () => {
              interactionFeedback.success();
              updateUserStatus(user.id, "sent", `Muddy request sent to ${user.displayName}.`);
              setAddOpen(false);'''
    ),
])

edit("components/friends/muddy-profile-page.tsx", [
    (
        'import { cn } from "@/lib/utils";\n',
        'import { cn } from "@/lib/utils";\nimport { feedback as interactionFeedback } from "@/lib/feedback/feedback";\n'
    ),
    (
        '''      const result = await sendWaveV2Action(muddy.friendId, "profile");
      setWaveFeedback(result.message);
      if (result.ok) setWaveSent(true);''',
        '''      const result = await sendWaveV2Action(muddy.friendId, "profile");
      setWaveFeedback(result.message);
      if (result.ok) {
        interactionFeedback.wave();
        setWaveSent(true);
      } else {
        interactionFeedback.error();
      }'''
    ),
    (
        '''      const result = await sendFriendRequestAction(muddy.friendId);
      setWaveFeedback(result.message);
      if (result.ok) setRequestSent(true);''',
        '''      const result = await sendFriendRequestAction(muddy.friendId);
      setWaveFeedback(result.message);
      if (result.ok) {
        interactionFeedback.success();
        setRequestSent(true);
      } else {
        interactionFeedback.error();
      }'''
    ),
    (
        '''      const result = await blockUserAction(muddy.friendId);
      if (result.ok) router.push("/friends");
      else setWaveFeedback(result.message);''',
        '''      const result = await blockUserAction(muddy.friendId);
      if (result.ok) {
        interactionFeedback.warning();
        router.push("/friends");
      } else {
        interactionFeedback.error();
        setWaveFeedback(result.message);
      }'''
    ),
])

edit("components/contacts/find-muddies-sheet.tsx", [
    (
        'import { haptic } from "@/lib/device/haptics";\n',
        'import { haptic } from "@/lib/device/haptics";\nimport { feedback as interactionFeedback } from "@/lib/feedback/feedback";\n'
    ),
    (
        '''      if (result.ok) {
        haptic("select");
        setRequested((current) => ({ ...current, [person.userId]: true }));
      } else {
        // Reported beside the list rather than replacing it: one failed add
        // must not throw away everybody else's row.
        setRowError(result.message);''',
        '''      if (result.ok) {
        interactionFeedback.success();
        setRequested((current) => ({ ...current, [person.userId]: true }));
      } else {
        interactionFeedback.error();
        // Reported beside the list rather than replacing it: one failed add
        // must not throw away everybody else's row.
        setRowError(result.message);'''
    ),
])

edit("components/socialize/socialize-page.tsx", [
    (
        'import { cn } from "@/lib/utils";\n',
        'import { cn } from "@/lib/utils";\nimport { feedback as interactionFeedback } from "@/lib/feedback/feedback";\n'
    ),
    (
        '''        if (result.reason === "incoming_request_exists") {
          setPeople((current) => restoreToDeck(current, { ...person, waveState: "received" }));
        } else {
          setPeople((current) => restoreToDeck(current, { ...person, waveState: "none" }));
        }
        showToast(result.message, true);
      } else {
        showToast(`Muddy request sent to ${capitalize(person.displayName || person.username)}.`);''',
        '''        if (result.reason === "incoming_request_exists") {
          interactionFeedback.light();
          setPeople((current) => restoreToDeck(current, { ...person, waveState: "received" }));
        } else {
          interactionFeedback.error();
          setPeople((current) => restoreToDeck(current, { ...person, waveState: "none" }));
        }
        showToast(result.message, true);
      } else {
        interactionFeedback.wave();
        showToast(`Muddy request sent to ${capitalize(person.displayName || person.username)}.`);'''
    ),
])

edit("components/messages/messages-page-v4.tsx", [
    (
        'import { MESSAGES_UPDATED_EVENT } from "@/hooks/use-unread-message-count";\n',
        'import { MESSAGES_UPDATED_EVENT } from "@/hooks/use-unread-message-count";\nimport { feedback as interactionFeedback } from "@/lib/feedback/feedback";\n'
    ),
    (
        '''    if (outcome === "pending") scheduleSendConfirmation(conversationId, clientMessageId);
    else cancelSendConfirmation(clientMessageId);''',
        '''    if (outcome === "failed") interactionFeedback.error();
    if (outcome === "pending") scheduleSendConfirmation(conversationId, clientMessageId);
    else cancelSendConfirmation(clientMessageId);'''
    ),
    (
        '''      if (!result.ok) {
        updateOptimistic(conversationId, (current) => markFailed(current, clientMessageId));
        setFeedback(result.message);
        return;
      }''',
        '''      if (!result.ok) {
        updateOptimistic(conversationId, (current) => markFailed(current, clientMessageId));
        setFeedback(result.message);
        interactionFeedback.error();
        return;
      }'''
    ),
    (
        '''      const result = await reactToMessageAction(messageId, reaction).catch(() => ({ ok: false, message: "Could not react." }));
      if (!result.ok) setFeedback(result.message);
      await refreshMessages(selectedId, false);''',
        '''      const result = await reactToMessageAction(messageId, reaction).catch(() => ({ ok: false, message: "Could not react." }));
      if (result.ok) interactionFeedback.selection();
      else {
        setFeedback(result.message);
        interactionFeedback.error();
      }
      await refreshMessages(selectedId, false);'''
    ),
])
