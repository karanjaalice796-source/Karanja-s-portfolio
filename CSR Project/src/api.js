export async function readApiJson(response) {
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('The account service returned an unexpected response. Start the app with npm run dev and open the server URL.');
  }

  if (!response.ok) {
    throw new Error(result.error || 'The account service could not complete your request.');
  }

  return result;
}
