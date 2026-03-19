
-- Add monthly income and investment goal to profiles
ALTER TABLE public.profiles
ADD COLUMN monthly_income numeric DEFAULT 0,
ADD COLUMN monthly_investment_goal numeric DEFAULT 0,
ADD COLUMN monthly_expenses_estimate numeric DEFAULT 0;
