import { schedule } from './scheduler';
import type { EventData, ScheduleOptions } from './types';
self.onmessage = (message: MessageEvent<{ event: EventData; options: ScheduleOptions }>) => {
  try { self.postMessage(schedule(message.data.event,message.data.options)); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : '자동배정 계산 중 오류가 발생했습니다.' }); }
};
