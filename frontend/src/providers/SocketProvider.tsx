import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';

const SocketContext = createContext<Socket | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
  // TODO: 연결 시작(connect())과 이벤트 배선(location:update 송신, encounter:detected 등
  // 수신 → useOverlayStore/useGameStore 반영)이 아직 구현되지 않음. 상세: docs/integrations.md
  const [socket] = useState(() =>
    io(apiUrl, {
      autoConnect: false,
      transports: ['websocket'],
    }),
  );

  useEffect(() => {
    return () => {
      socket.disconnect();
    };
  }, [socket]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

export const useSocket = () => useContext(SocketContext);
