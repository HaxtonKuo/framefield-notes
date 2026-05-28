export type DownloadItem = {
  title: string;
  description: string;
  category: string;
  fileType: string;
  url: string;
  updatedAt: string;
  isFeatured?: boolean;
};

export const downloads: DownloadItem[] = [
  {
    title: "AI 設計 Prompt Pack",
    description: "把你的 Google Drive 分享連結貼到這裡，作為指令包下載入口。",
    category: "Prompt Pack",
    fileType: "Google Drive",
    url: "https://drive.google.com/",
    updatedAt: "2026-05-28",
    isFeatured: true,
  },
  {
    title: "案例圖片原始素材",
    description: "適合放原始 AI 圖、參考截圖或案例補充素材，不要直接塞進 GitHub。",
    category: "素材包",
    fileType: "Google Drive",
    url: "https://drive.google.com/",
    updatedAt: "2026-05-28",
  },
  {
    title: "教學 PDF 範本",
    description: "未來可放 PDF、ZIP 或課程講義連結。",
    category: "PDF",
    fileType: "Google Drive",
    url: "https://drive.google.com/",
    updatedAt: "2026-05-28",
  },
];
