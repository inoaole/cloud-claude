import { Stub } from '../components/Stub';
import { IconToday } from '../components/icons';

/** Today — the calm landing state after unlock. Real daily-loop content (agenda,
    recent activity, reflection nudge) ships with the Hub-plane sprint. */
export function Today() {
  return (
    <Stub
      icon={IconToday}
      title="Unlocked."
      note="Your day at a glance lands here — agenda, recent activity, and a reflection nudge."
    />
  );
}
