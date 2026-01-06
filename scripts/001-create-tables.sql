-- pBTC Buyback & Distribution System Tables

-- System configuration (stores encrypted dev wallet, settings)
CREATE TABLE IF NOT EXISTS system_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Buyback transactions
CREATE TABLE IF NOT EXISTS buybacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sol_amount DECIMAL(20, 9) NOT NULL,
  wbtc_amount DECIMAL(20, 9),
  tx_signature TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Distribution records
CREATE TABLE IF NOT EXISTS distributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyback_id UUID REFERENCES buybacks(id),
  wallet_address TEXT NOT NULL,
  wbtc_amount DECIMAL(20, 9) NOT NULL,
  holder_rank INTEGER NOT NULL,
  tx_signature TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Top holders snapshot (updated each cycle)
CREATE TABLE IF NOT EXISTS holders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  pbtc_balance DECIMAL(20, 9) NOT NULL,
  rank INTEGER NOT NULL,
  last_reward_amount DECIMAL(20, 9),
  last_reward_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Activity log for real-time feed
CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('buyback', 'swap', 'distribution')),
  amount DECIMAL(20, 9) NOT NULL,
  token_symbol TEXT NOT NULL,
  wallet_address TEXT,
  tx_signature TEXT,
  status TEXT DEFAULT 'completed',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_buybacks_created_at ON buybacks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_distributions_buyback_id ON distributions(buyback_id);
CREATE INDEX IF NOT EXISTS idx_distributions_wallet ON distributions(wallet_address);
CREATE INDEX IF NOT EXISTS idx_holders_rank ON holders(rank);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_type ON activity_log(type);

-- Enable realtime for activity_log
ALTER PUBLICATION supabase_realtime ADD TABLE activity_log;
ALTER PUBLICATION supabase_realtime ADD TABLE holders;
ALTER PUBLICATION supabase_realtime ADD TABLE buybacks;
