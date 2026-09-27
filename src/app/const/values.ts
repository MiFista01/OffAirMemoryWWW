export const maxPagination = 5;

export const activeLanguages = ["ee", "en"];


export const cronSchedules = {
  // add cron expressions as needed
} as const;

export const transFileNames = [
  {
    name: "common",
    files: [
      "common",
      "widgets",
      "table",
      "btns",
      "placeholders",
      "errors",
      "toast",
    ],
  },
  {
    name: "guest",
    files: [
      "guest",
      "reg",
    ],
  },
  {
    name: "user",
    files: [
      "user",
      "settings",
      "toast",
    ],
  },
];
