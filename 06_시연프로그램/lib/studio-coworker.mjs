import {setTimeout as delay} from 'node:timers/promises';

export async function askStudioCoworker({apiKey, agentId, input, timeoutMs = 60000}) {
  const base = 'https://api.upstage.ai/v2/agents/sessions';
  const headers = {Authorization: 'Bearer ' + apiKey, 'Upstage-Agent-Version': 'v2'};
  const signal = AbortSignal.timeout(timeoutMs);
  async function read(url, options) {
    const response = await fetch(url, {headers, signal, redirect: 'error', ...options});
    if (!response.ok) throw Error('coworker_http_error');
    return response.json();
  }
  const session = await read(base, {method: 'POST', headers: {...headers, 'Content-Type': 'application/json'},
    body: JSON.stringify({agent_id: agentId, input})});
  if (!/^sess_[\w-]+$/.test(session.id || '')) throw Error('coworker_session_invalid');
  const turns = base + '/' + encodeURIComponent(session.id) + '/turns?limit=1';
  while (!signal.aborted) {
    const {data} = await read(turns);
    if (!Array.isArray(data)) throw Error('coworker_response_invalid');
    const turn = data[0];
    if (turn?.status === 'completed') {
      const answer = turn.output?.filter(item => item.type === 'message' && item.role === 'assistant')
        .flatMap(item => item.content || []).filter(item => item.type === 'output_text' && typeof item.text === 'string')
        .map(item => item.text).join('\n').trim();
      if (!answer) throw Error('coworker_response_invalid');
      return answer;
    }
    if (turn?.error?.code === 'invalid_model_id') throw Error('coworker_model_invalid');
    if (turn && !['queued', 'in_progress'].includes(turn.status)) throw Error('coworker_turn_failed');
    await delay(1500, undefined, {signal});
  }
  throw Error('coworker_timeout');
}
