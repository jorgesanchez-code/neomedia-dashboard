const MAX_TEXT = 1200;

function trimText(value, max = MAX_TEXT) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function compactPayload(body) {
  return {
    prompt: trimText(body.prompt, 600),
    metrics: body.metrics || {},
    riskyClients: Array.isArray(body.riskyClients) ? body.riskyClients.slice(0, 10) : [],
    criticalDevices: Array.isArray(body.criticalDevices)
      ? body.criticalDevices.slice(0, 20).map(d => ({
          nombre: trimText(d.nombre, 160),
          cliente: trimText(d.cliente, 80),
          pais: trimText(d.pais, 80),
          diasDesconexion: d.diasDesconexion,
          ultimoAcceso: trimText(d.ultimoAcceso, 120),
          ip: trimText(d.ip, 64)
        }))
      : [],
    openTickets: Array.isArray(body.openTickets)
      ? body.openTickets.slice(0, 20).map(t => ({
          ticketNumber: t.ticketNumber,
          deviceName: trimText(t.deviceName, 160),
          date: trimText(t.date, 32),
          result: trimText(t.result, 40),
          technician: trimText(t.technician, 120),
          type: trimText(t.type, 60),
          description: trimText(t.description, 500)
        }))
      : []
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY no configurada en el servidor' });
  }

  const context = compactPayload(req.body || {});

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5-mini',
        instructions: [
          'Eres un analista senior de operaciones para un dashboard de pantallas digitales.',
          'Responde en español, con prioridades accionables, riesgos, siguientes pasos y sin inventar datos.',
          'Si faltan datos, dilo claramente. No expongas claves, IDs internos ni información innecesaria.'
        ].join(' '),
        input: `Pregunta del usuario:\n${context.prompt}\n\nContexto operativo JSON:\n${JSON.stringify(context, null, 2)}`,
        max_output_tokens: 700
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Error de OpenAI' });
    }

    return res.status(200).json({ answer: data.output_text || 'No se recibió respuesta textual del modelo.' });
  } catch (error) {
    return res.status(500).json({ error: error.message || String(error) });
  }
}
