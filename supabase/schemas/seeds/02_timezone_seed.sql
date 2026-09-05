INSERT INTO public.timezones
(code, display_name, country)
VALUES

('UTC', 'Coordinated Universal Time', 'Global'),

('Asia/Kolkata', 'India Standard Time (IST)', 'India'),
('Asia/Dubai', 'Gulf Standard Time', 'United Arab Emirates'),
('Asia/Karachi', 'Pakistan Standard Time', 'Pakistan'),
('Asia/Dhaka', 'Bangladesh Standard Time', 'Bangladesh'),
('Asia/Bangkok', 'Indochina Time', 'Thailand'),
('Asia/Singapore', 'Singapore Standard Time', 'Singapore'),
('Asia/Kuala_Lumpur', 'Malaysia Standard Time', 'Malaysia'),
('Asia/Jakarta', 'Western Indonesia Time', 'Indonesia'),
('Asia/Manila', 'Philippine Standard Time', 'Philippines'),
('Asia/Tokyo', 'Japan Standard Time', 'Japan'),
('Asia/Seoul', 'Korea Standard Time', 'South Korea'),
('Asia/Shanghai', 'China Standard Time', 'China'),
('Asia/Hong_Kong', 'Hong Kong Time', 'Hong Kong'),

('Europe/London', 'Greenwich Mean Time', 'United Kingdom'),
('Europe/Paris', 'Central European Time', 'France'),
('Europe/Berlin', 'Central European Time', 'Germany'),
('Europe/Madrid', 'Central European Time', 'Spain'),
('Europe/Rome', 'Central European Time', 'Italy'),
('Europe/Amsterdam', 'Central European Time', 'Netherlands'),

('America/New_York', 'Eastern Time', 'United States'),
('America/Chicago', 'Central Time', 'United States'),
('America/Denver', 'Mountain Time', 'United States'),
('America/Los_Angeles', 'Pacific Time', 'United States'),
('America/Toronto', 'Eastern Time', 'Canada'),
('America/Vancouver', 'Pacific Time', 'Canada'),

('Australia/Sydney', 'Australian Eastern Time', 'Australia'),
('Australia/Melbourne', 'Australian Eastern Time', 'Australia'),
('Australia/Perth', 'Australian Western Time', 'Australia'),

('Pacific/Auckland', 'New Zealand Standard Time', 'New Zealand'),

-- Added for the signup flow: the create-org / onboarding Select offers a "brt" and an
-- "eet" option (src/features/auth/lib/timezones.ts), and without these two rows picking
-- either one fails to resolve to a `timezones.id` and blocks provisioning.
('America/Sao_Paulo', 'Brasilia Time', 'Brazil'),
('Europe/Athens', 'Eastern European Time', 'Greece');