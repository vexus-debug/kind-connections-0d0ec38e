SELECT cron.schedule(
  'scanner-cron-every-15min',
  '*/15 * * * *',
  $$
  SELECT
    net.http_post(
        url:='https://otssdmzghjbeqntvuxgj.supabase.co/functions/v1/scanner-cron',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90c3NkbXpnaGpiZXFudHZ1eGdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwOTgxNzAsImV4cCI6MjA4ODY3NDE3MH0.xuaPh_rGdQXggQAAblD-RolGGGolvrbBOOSDf5kscM8"}'::jsonb,
        body:=concat('{"time": "', now(), '"}')::jsonb
    ) as request_id;
  $$
);