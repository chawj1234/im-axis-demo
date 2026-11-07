import type {Metadata, Viewport} from 'next';

export const metadata: Metadata = {title: 'iM Bank · 고객 알림 시연'};
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover',
  themeColor: '#dff0ed', colorScheme: 'light',
};

export default function CustomerLayout({children}: {children: React.ReactNode}) {
  return children;
}
