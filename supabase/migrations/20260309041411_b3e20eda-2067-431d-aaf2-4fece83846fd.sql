-- Create admin activity logs table
CREATE TABLE public.admin_activity_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add index for efficient queries
CREATE INDEX idx_admin_activity_logs_created_at ON public.admin_activity_logs(created_at DESC);
CREATE INDEX idx_admin_activity_logs_user_id ON public.admin_activity_logs(user_id);
CREATE INDEX idx_admin_activity_logs_action ON public.admin_activity_logs(action);

-- Enable RLS (only admins can read these logs)
ALTER TABLE public.admin_activity_logs ENABLE ROW LEVEL SECURITY;

-- Only allow reading logs via edge functions (no direct access)
-- This will be handled by the admin-metrics edge function with proper validation