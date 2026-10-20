if (!document.querySelector('link[data-rooms-invitations-style]')) {
  const roomInvitationStyles = document.createElement('link');
  roomInvitationStyles.rel = 'stylesheet';
  roomInvitationStyles.href = '/app/assets/rooms-invitations.css?v=20260909-rooms1';
  roomInvitationStyles.dataset.roomsInvitationsStyle = 'true';
  document.head.append(roomInvitationStyles);
}
