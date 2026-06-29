import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';

const SocketContext = createContext<Socket | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

  useEffect(() => {
    const s = io(apiUrl, {
      autoConnect: false,
      transports: ['websocket'],
    });
    setSocket(s);
    return () => {
      s.disconnect();
    };
  }, [apiUrl]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

export const useSocket = () => useContext(SocketContext);
