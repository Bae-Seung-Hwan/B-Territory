import { useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useLocation } from '@/hooks/use-location';
import { useSocket } from '@/providers/SocketProvider';
import { LOCATION_HEARTBEAT_MS } from '@/constants/game';

/**
 * 내 위치를 서버로 계속 흘려보내는 무화면 컴포넌트. 지도 화면이 아니라 앱 루트에 두는
 * 이유는, 서버가 `location:update`를 조우 탐지뿐 아니라 "이 유저가 접속 중인가"를
 * 판단하는 근거로도 쓰기 때문이다(`user:meta:*`, TTL 120초). 특정 탭에 묶어두면
 * 그 화면을 벗어나 있는 동안 결투 알림을 실시간으로 못 받게 된다.
 */
function LocationBroadcasterInner() {
  const { coords } = useLocation();
  const socket = useSocket();

  useEffect(() => {
    if (!socket || !coords) return;
    const payload = { lat: coords.latitude, lng: coords.longitude };

    // 끊긴 상태에서 emit하면 socket.io가 버퍼에 쌓아뒀다가 재연결 시 한꺼번에 흘려보내
    // 이미 지나온 좌표로 조우 판정이 난다 — 연결됐을 때만 보내고, 끊겨 있었다면
    // 재연결 시점에 (그때의 최신 좌표로 다시 실행되는) 이 effect가 보낸다.
    const send = () => {
      if (socket.connected) socket.emit('location:update', payload);
    };

    send();
    // 좌표가 바뀌면 effect가 재실행되며 타이머도 새로 시작한다 — 하트비트는 어차피
    // "움직이지 않는 동안"만 필요하므로 이 리셋이 맞는 동작이다.
    const heartbeat = setInterval(send, LOCATION_HEARTBEAT_MS);
    socket.on('connect', send);

    return () => {
      clearInterval(heartbeat);
      socket.off('connect', send);
    };
  }, [coords, socket]);

  return null;
}

export function LocationBroadcaster() {
  const { isAuthenticated } = useAuth();
  // 로그인 전에는 마운트하지 않는다 — 로그인·회원가입 화면에서 위치 권한을 묻지 않도록.
  if (!isAuthenticated) return null;
  return <LocationBroadcasterInner />;
}
