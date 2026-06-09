export type AppSettings = {
  automationRunning: boolean;
  mlEnabled: boolean;
  amazonEnabled: boolean;
  amazonTag: string;
  shopeeEnabled: boolean;
  shopeeAppId: string;
  shopeeSecret: string;
  shopeeFeedCount: number;
  sendIntervalMinutes: number;
  sendIntervalPool: number[];
  useIntervalPool: boolean;
  activeHoursStart: number;
  activeHoursEnd: number;
  feedCount: number;
  amazonFeedCount: number;
  feedAmHour: number;
  feedPmHour: number;
  feedReactiveThreshold: number;
  autoFeedEnabled: boolean;
};

export const SETTINGS_DEFAULTS: AppSettings = {
  automationRunning: false,
  mlEnabled: true,
  amazonEnabled: false,
  amazonTag: "",
  shopeeEnabled: false,
  shopeeAppId: "",
  shopeeSecret: "",
  shopeeFeedCount: 10,
  sendIntervalMinutes: 15,
  sendIntervalPool: [11, 7, 15],
  useIntervalPool: true,
  activeHoursStart: 8,
  activeHoursEnd: 22,
  feedCount: 20,
  amazonFeedCount: 10,
  feedAmHour: 8,
  feedPmHour: 14,
  feedReactiveThreshold: 3,
  autoFeedEnabled: true,
};
