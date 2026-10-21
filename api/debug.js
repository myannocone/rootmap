export default function handler(req, res) {
  const clientId = process.env.YAHOO_CLIENT_ID || 'NOT_SET';
  const redirectUri = process.env.YAHOO_REDIRECT_URI || 'NOT_SET';
  
  // Mask the middle of the ID for privacy but show prefix/suffix/length
  const preview = clientId.length > 8 
    ? `${clientId.substring(0, 6)}...${clientId.substring(clientId.length - 4)} (length: ${clientId.length})` 
    : clientId;

  res.status(200).json({
    hasClientId: clientId !== 'NOT_SET',
    clientPreview: preview,
    redirectUri: redirectUri
  });
}
