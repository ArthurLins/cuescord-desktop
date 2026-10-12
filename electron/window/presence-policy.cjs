function validPresence(value) {
  if (
    !value ||
    !Number.isSafeInteger(value.unreadCount) ||
    value.unreadCount < 0 ||
    typeof value.inCall !== 'boolean' ||
    typeof value.microphoneMuted !== 'boolean'
  )
    throw new Error('Estado do desktop inválido.');
  return {
    unreadCount: value.unreadCount,
    inCall: value.inCall,
    microphoneMuted: value.inCall && value.microphoneMuted,
  };
}

module.exports = { validPresence };
