import { useRef, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useScroll, useTransform, useSpring, useInView } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';
import {
  ArrowRight, Check, Star, ChevronDown, PieChart, LineChart, Target, 
  Layers, Wallet, Globe, TrendingUp, Shield, BarChart3, Eye, Sparkles
} from 'lucide-react';

/* ─── Scroll-aware reveal ─── */
const Reveal = ({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-60px' });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 36 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={className}
    >
      {children}
    </motion.div>
  );
};

/* ─────────────────────────── NAVBAR ─────────────────────────── */
const Navbar = () => {
  const { user } = useAuth();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <motion.nav
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, delay: 0.2 }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        scrolled
          ? 'bg-[hsl(222_47%_5%/0.8)] backdrop-blur-2xl border-b border-[hsl(var(--border)/0.25)] shadow-2xl shadow-black/30'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(270_67%_62%)] flex items-center justify-center shadow-lg shadow-[hsl(var(--primary)/0.3)]">
            <span className="text-sm font-bold text-white">F</span>
          </div>
          <span className="text-lg font-semibold text-foreground tracking-tight">Fortuna</span>
        </Link>

        <div className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
          <a href="#produto" className="hover:text-foreground transition-colors">Produto</a>
          <a href="#recursos" className="hover:text-foreground transition-colors">Recursos</a>
          <a href="#planos" className="hover:text-foreground transition-colors">Planos</a>
        </div>

        <div className="flex items-center gap-3">
          {user ? (
            <Link
              to="/app/dashboard"
              className="px-5 py-2 rounded-lg bg-[hsl(var(--primary))] text-primary-foreground text-sm font-medium hover:brightness-110 transition-all shadow-lg shadow-[hsl(var(--primary)/0.25)]"
            >
              Ir para Dashboard
            </Link>
          ) : (
            <>
              <Link to="/auth" className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:block">
                Entrar
              </Link>
              <Link
                to="/auth"
                className="px-5 py-2 rounded-lg bg-[hsl(var(--primary))] text-primary-foreground text-sm font-medium hover:brightness-110 transition-all shadow-lg shadow-[hsl(var(--primary)/0.25)]"
              >
                Criar conta grátis
              </Link>
            </>
          )}
        </div>
      </div>
    </motion.nav>
  );
};

/* ─────────────────────────── HERO ─────────────────────────── */
const Hero = () => {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1.3]);
  const opacity = useTransform(scrollYProgress, [0, 0.6], [1, 0]);
  const y = useTransform(scrollYProgress, [0, 1], [0, 150]);
  const smoothScale = useSpring(scale, { stiffness: 40, damping: 20 });

  return (
    <section ref={ref} className="relative h-[105vh] min-h-[750px] flex items-center justify-center overflow-hidden">
      {/* Video */}
      <motion.div className="absolute inset-0" style={{ scale: smoothScale }}>
        <video autoPlay loop muted playsInline className="absolute inset-0 w-full h-full object-cover" src="/videos/planeta-azul.mp4" />
        <div className="absolute inset-0 bg-gradient-to-b from-[hsl(222_47%_4%/0.55)] via-[hsl(222_47%_4%/0.35)] to-[hsl(222_47%_4%/0.97)]" />
        <div className="absolute inset-0 bg-gradient-to-r from-[hsl(222_47%_4%/0.35)] via-transparent to-[hsl(222_47%_4%/0.35)]" />
      </motion.div>

      {/* Floating ambient KPIs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {[
          { label: 'Patrimônio', value: 'R$ 1.247.832', x: '8%', y: '28%', delay: 2 },
          { label: 'Dividendos 12m', value: 'R$ 48.190', x: '78%', y: '22%', delay: 2.8 },
          { label: 'Rentabilidade', value: '+24.7%', x: '85%', y: '68%', delay: 3.4 },
        ].map((kpi, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.35 }}
            transition={{ delay: kpi.delay, duration: 1.5 }}
            className="absolute hidden lg:block"
            style={{ left: kpi.x, top: kpi.y }}
          >
            <motion.div
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 5 + i, repeat: Infinity, ease: 'easeInOut' }}
              className="px-4 py-2.5 rounded-lg border border-[hsl(var(--border)/0.15)] bg-[hsl(222_47%_5%/0.4)] backdrop-blur-sm"
            >
              <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground/70">{kpi.label}</p>
              <p className="text-sm font-semibold text-foreground/60 font-mono">{kpi.value}</p>
            </motion.div>
          </motion.div>
        ))}
      </div>

      {/* Content */}
      <motion.div style={{ opacity, y }} className="relative z-10 max-w-5xl mx-auto px-6 text-center">
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.4 }}>
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[hsl(var(--border)/0.3)] bg-[hsl(var(--card)/0.3)] backdrop-blur-sm text-xs text-muted-foreground mb-8">
            <Star className="w-3.5 h-3.5 text-[hsl(var(--primary))]" />
            Inteligência patrimonial para investidores
          </div>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.6 }}
          className="text-5xl sm:text-6xl lg:text-8xl font-bold tracking-[-0.03em] leading-[1.05] mb-7"
        >
          <span className="text-foreground">Seu patrimônio</span>
          <br />
          <span className="text-foreground">em </span>
          <span className="bg-gradient-to-r from-[hsl(var(--primary))] via-[hsl(199_89%_62%)] to-[hsl(270_60%_70%)] bg-clip-text text-transparent">
            nova órbita
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.85 }}
          className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-12 leading-relaxed"
        >
          Acompanhe investimentos, visualize evolução patrimonial e tome decisões com mais clareza.
          Uma plataforma construída para quem pensa em longo prazo.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 1.1 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <Link
            to="/auth"
            className="group px-9 py-4 rounded-xl bg-[hsl(var(--primary))] text-primary-foreground font-semibold text-base hover:brightness-110 transition-all shadow-2xl shadow-[hsl(var(--primary)/0.3)] flex items-center gap-2.5"
          >
            Começar gratuitamente
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </Link>
          <a
            href="#produto"
            className="px-9 py-4 rounded-xl border border-[hsl(var(--border)/0.4)] bg-[hsl(var(--card)/0.25)] backdrop-blur-sm text-foreground font-medium text-base hover:bg-[hsl(var(--card)/0.45)] transition-all"
          >
            Conhecer o produto
          </a>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.8 }}
          className="absolute bottom-10 left-1/2 -translate-x-1/2"
        >
          <motion.div animate={{ y: [0, 8, 0] }} transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}>
            <ChevronDown className="w-5 h-5 text-muted-foreground/40" />
          </motion.div>
        </motion.div>
      </motion.div>
    </section>
  );
};

/* ─────────────────────── PRODUCT SHOWCASE ─────────────────────── */
const ProductShowcase = () => {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const mockScale = useTransform(scrollYProgress, [0, 0.4, 0.7], [0.88, 1, 0.98]);
  const mockRotateX = useTransform(scrollYProgress, [0, 0.5, 1], [6, 0, -2]);
  const mockOpacity = useTransform(scrollYProgress, [0, 0.25, 0.8, 1], [0.4, 1, 1, 0.6]);

  return (
    <section id="produto" ref={ref} className="relative py-32 px-6 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-background via-[hsl(222_47%_5.5%)] to-background" />

      <div className="relative max-w-6xl mx-auto">
        <Reveal className="text-center mb-20">
          <p className="text-xs uppercase tracking-[0.3em] text-[hsl(var(--primary))] font-semibold mb-4">Produto</p>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-foreground mb-5 leading-tight">
            Seu painel de controle<br className="hidden sm:block" /> patrimonial
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto leading-relaxed">
            Dashboard completo com métricas em tempo real, gráficos de alocação, rentabilidade comparada e insights automatizados — tudo em uma única interface.
          </p>
        </Reveal>

        {/* Dashboard mock */}
        <motion.div
          style={{ scale: mockScale, rotateX: mockRotateX, opacity: mockOpacity, perspective: 1200 }}
          className="relative rounded-2xl overflow-hidden border border-[hsl(var(--border)/0.25)] shadow-[0_32px_80px_-12px_hsl(var(--primary)/0.12),0_0_0_1px_hsl(var(--border)/0.1)]"
        >
          <div className="bg-[hsl(222_47%_7%)] p-6 sm:p-8">
            {/* Mock top bar */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-md bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(270_67%_62%)] flex items-center justify-center">
                  <span className="text-[10px] font-bold text-white">F</span>
                </div>
                <span className="text-sm font-semibold text-foreground/80">Dashboard</span>
              </div>
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-[hsl(var(--positive)/0.6)]" />
                <div className="w-2.5 h-2.5 rounded-full bg-[hsl(45_100%_60%/0.5)]" />
                <div className="w-2.5 h-2.5 rounded-full bg-[hsl(var(--destructive)/0.4)]" />
              </div>
            </div>

            {/* Mock KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              {[
                { label: 'Patrimônio Total', value: 'R$ 247.832', change: '+12.4%', positive: true },
                { label: 'Dividendos 12m', value: 'R$ 8.190', change: '+3.2%', positive: true },
                { label: 'Dividend Yield', value: '4.8%', change: '+0.3%', positive: true },
                { label: 'Aportes no Mês', value: 'R$ 3.500', change: 'Regular', positive: true },
              ].map((kpi, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.4 + i * 0.1 }}
                  className="p-4 rounded-xl bg-[hsl(222_47%_9%)] border border-[hsl(var(--border)/0.15)]"
                >
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground/70 mb-1.5">{kpi.label}</p>
                  <p className="text-lg font-bold text-foreground font-mono">{kpi.value}</p>
                  <p className="text-[11px] text-[hsl(var(--positive))] mt-0.5">{kpi.change}</p>
                </motion.div>
              ))}
            </div>

            {/* Mock charts */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Performance chart mock */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.7 }}
                className="sm:col-span-2 p-4 rounded-xl bg-[hsl(222_47%_9%)] border border-[hsl(var(--border)/0.15)]"
              >
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground/70 mb-4">Rentabilidade vs Benchmarks</p>
                <div className="h-32 sm:h-40 flex items-end gap-[2px]">
                  {Array.from({ length: 24 }, (_, i) => {
                    const h = 20 + Math.sin(i * 0.4) * 30 + i * 3.2;
                    return (
                      <div key={i} className="flex-1 rounded-t-sm bg-gradient-to-t from-[hsl(var(--primary)/0.3)] to-[hsl(var(--primary)/0.7)]" style={{ height: `${Math.min(h, 100)}%` }} />
                    );
                  })}
                </div>
                <div className="flex items-center gap-4 mt-3">
                  <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><span className="w-2 h-2 rounded-full bg-[hsl(var(--primary))]" />Carteira</span>
                  <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><span className="w-2 h-2 rounded-full bg-[hsl(45_100%_60%/0.6)]" />CDI</span>
                  <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><span className="w-2 h-2 rounded-full bg-[hsl(var(--positive)/0.6)]" />IBOV</span>
                </div>
              </motion.div>

              {/* Allocation mock */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.85 }}
                className="p-4 rounded-xl bg-[hsl(222_47%_9%)] border border-[hsl(var(--border)/0.15)]"
              >
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground/70 mb-4">Alocação</p>
                <div className="flex justify-center mb-4">
                  <div className="w-28 h-28 rounded-full border-[10px] border-[hsl(var(--primary)/0.7)] relative">
                    <div className="absolute inset-0 rounded-full border-[10px] border-transparent border-t-[hsl(var(--positive)/0.7)] border-r-[hsl(var(--positive)/0.7)] rotate-[60deg]" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  {[
                    { name: 'Ações', pct: '48%', color: 'hsl(var(--primary))' },
                    { name: 'FIIs', pct: '28%', color: 'hsl(var(--positive))' },
                    { name: 'Renda Fixa', pct: '24%', color: 'hsl(45 100% 60%)' },
                  ].map((c, i) => (
                    <div key={i} className="flex items-center justify-between text-[11px]">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                        {c.name}
                      </span>
                      <span className="text-foreground/80 font-mono">{c.pct}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

/* ─────────────────────── FEATURES GRID (Premium layout) ─────────────────────── */
const featuresData = [
  { icon: PieChart, title: 'Alocação por Classe', desc: 'Visualize a composição do patrimônio por classe de ativo, com metas e bandas de rebalanceamento configuráveis.', large: true },
  { icon: LineChart, title: 'Rentabilidade Comparada', desc: 'Compare retorno com CDI, IPCA, IBOV e S&P 500 em múltiplos períodos.' },
  { icon: Target, title: 'Rebalanceamento', desc: 'Sugestões automáticas para manter a carteira alinhada à estratégia definida.' },
  { icon: Layers, title: 'Scoring de Ativos', desc: 'Avalie qualidade, valuation, dividendos, crescimento e risco de cada posição com notas de 0 a 10.', large: true },
  { icon: Wallet, title: 'Gestão de Aportes', desc: 'Registre e acompanhe todos os aportes com detalhamento por ativo e data.' },
  { icon: Globe, title: 'Valuations', desc: 'Modelos Bazin, Graham, DCF e mais — integrados para cada ativo da carteira.' },
];

const Features = () => (
  <section id="recursos" className="relative py-32 px-6">
    <div className="absolute inset-0 bg-gradient-to-b from-background via-[hsl(222_47%_5.5%)] to-background" />
    <div className="relative max-w-6xl mx-auto">
      <Reveal className="text-center mb-20">
        <p className="text-xs uppercase tracking-[0.3em] text-[hsl(var(--primary))] font-semibold mb-4">Recursos</p>
        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-foreground mb-5">
          Ferramentas que investidores<br className="hidden sm:block" /> realmente precisam
        </h2>
        <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
          Cada módulo foi desenhado para trazer clareza, controle e inteligência à sua jornada patrimonial.
        </p>
      </Reveal>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {featuresData.map((f, i) => (
          <Reveal key={i} delay={i * 0.07}>
            <div
              className={`group relative p-7 rounded-2xl border border-[hsl(var(--border)/0.15)] bg-[hsl(var(--card)/0.25)] hover:bg-[hsl(var(--card)/0.55)] hover:border-[hsl(var(--border)/0.45)] transition-all duration-500 h-full ${
                f.large ? 'sm:col-span-2 lg:col-span-1 lg:row-span-1' : ''
              }`}
            >
              <div className="w-10 h-10 rounded-lg bg-[hsl(var(--primary)/0.08)] flex items-center justify-center mb-5 group-hover:bg-[hsl(var(--primary)/0.14)] transition-colors">
                <f.icon className="w-5 h-5 text-[hsl(var(--primary))]" />
              </div>
              <h3 className="text-base font-semibold text-foreground mb-2.5">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
);

/* ─────────────────────── PROOF OF PRODUCT ─────────────────────── */
const ProofSection = () => {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const videoScale = useTransform(scrollYProgress, [0, 0.5, 1], [1.1, 1, 1.05]);
  const overlayOp = useTransform(scrollYProgress, [0, 0.5, 1], [0.5, 0.35, 0.55]);

  const metrics = [
    { icon: BarChart3, label: 'Scoring Multifatorial', detail: 'Qualidade · Crescimento · Valuation · Risco · Dividendos', value: '5 pilares' },
    { icon: TrendingUp, label: 'Benchmarks Integrados', detail: 'CDI · IPCA · IBOV · S&P 500', value: '4+ índices' },
    { icon: Shield, label: 'Rebalanceamento', detail: 'Metas, bandas e sugestões automáticas por classe', value: 'Automático' },
    { icon: Sparkles, label: 'Insights Inteligentes', detail: 'Concentração, diversificação, desvios e alertas', value: 'Em tempo real' },
  ];

  return (
    <section ref={ref} className="relative py-32 px-6 overflow-hidden">
      <motion.div className="absolute inset-0" style={{ scale: videoScale }}>
        <video autoPlay loop muted playsInline className="absolute inset-0 w-full h-full object-cover" src="/videos/hero-bg.mp4" />
      </motion.div>
      <motion.div className="absolute inset-0 bg-[hsl(222_47%_5%)]" style={{ opacity: overlayOp }} />

      <div className="relative max-w-6xl mx-auto">
        <Reveal className="text-center mb-20">
          <p className="text-xs uppercase tracking-[0.3em] text-[hsl(var(--primary))] font-semibold mb-4">Por dentro</p>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-foreground mb-5 leading-tight">
            A inteligência por trás<br className="hidden sm:block" /> de cada decisão
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            O Fortuna combina análise quantitativa, benchmarks e scoring para transformar dados complexos em visão estratégica.
          </p>
        </Reveal>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {metrics.map((m, i) => (
            <Reveal key={i} delay={i * 0.1}>
              <div className="group flex items-start gap-5 p-6 rounded-2xl border border-[hsl(var(--border)/0.15)] bg-[hsl(222_47%_6%/0.5)] backdrop-blur-sm hover:bg-[hsl(222_47%_8%/0.6)] hover:border-[hsl(var(--border)/0.35)] transition-all duration-500">
                <div className="w-11 h-11 rounded-xl bg-[hsl(var(--primary)/0.1)] flex items-center justify-center flex-shrink-0 group-hover:bg-[hsl(var(--primary)/0.15)] transition-colors">
                  <m.icon className="w-5 h-5 text-[hsl(var(--primary))]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-sm font-semibold text-foreground">{m.label}</h3>
                    <span className="text-xs font-mono text-[hsl(var(--primary))]">{m.value}</span>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{m.detail}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
};

/* ─────────────────────── PRICING ─────────────────────── */
const plans = [
  {
    name: 'Órbita',
    price: 'Grátis',
    period: '',
    desc: 'Para quem quer começar a organizar a vida financeira com mais clareza.',
    features: [
      'Até 10 ativos acompanhados',
      'Dashboard essencial',
      'Rentabilidade simplificada',
      'Alocação por classe de ativo',
      '1 carteira',
    ],
    cta: 'Começar grátis',
    highlighted: false,
  },
  {
    name: 'Constelação',
    price: 'R$ 10',
    priceSup: ',97',
    period: '/mês',
    desc: 'Para quem quer mais visão, mais controle e mais profundidade na gestão patrimonial.',
    badge: 'Melhor custo-benefício',
    features: [
      'Até 50 ativos acompanhados',
      'Dashboard completo com insights',
      'Rentabilidade comparada (CDI, IBOV, S&P 500)',
      'Rebalanceamento inteligente',
      'Scoring multifatorial de ativos',
      'Gestão detalhada de aportes',
      'Histórico ampliado',
      'Até 3 carteiras',
    ],
    cta: 'Assinar Constelação',
    highlighted: true,
  },
  {
    name: 'Galáxia',
    price: 'R$ 59',
    priceSup: ',97',
    period: '/mês',
    desc: 'A experiência completa para quem leva patrimônio e investimentos a sério.',
    features: [
      'Ativos ilimitados',
      'Todos os recursos do Constelação',
      'Valuations (Bazin, Graham, DCF)',
      'Correlação entre ativos',
      'Relatórios avançados e exportação',
      'Backup completo de dados',
      'Metas patrimoniais',
      'Carteiras ilimitadas',
      'Suporte prioritário',
    ],
    cta: 'Assinar Galáxia',
    highlighted: false,
  },
];

const Pricing = () => (
  <section id="planos" className="relative py-32 px-6">
    <div className="absolute inset-0 bg-gradient-to-b from-background via-[hsl(222_47%_5.5%)] to-background" />
    <div className="relative max-w-6xl mx-auto">
      <Reveal className="text-center mb-20">
        <p className="text-xs uppercase tracking-[0.3em] text-[hsl(var(--primary))] font-semibold mb-4">Planos</p>
        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-foreground mb-5">
          Escolha sua órbita
        </h2>
        <p className="text-muted-foreground text-lg max-w-xl mx-auto">
          Cada plano é pensado para uma fase da sua jornada patrimonial. Comece grátis e evolua quando quiser.
        </p>
      </Reveal>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-start">
        {plans.map((plan, i) => (
          <Reveal key={i} delay={i * 0.1}>
            <div
              className={`relative rounded-2xl p-8 transition-all duration-500 ${
                plan.highlighted
                  ? 'bg-gradient-to-b from-[hsl(var(--primary)/0.07)] to-[hsl(var(--card)/0.5)] border-2 border-[hsl(var(--primary)/0.35)] shadow-[0_24px_64px_-12px_hsl(var(--primary)/0.15)] md:scale-[1.03]'
                  : 'bg-[hsl(var(--card)/0.25)] border border-[hsl(var(--border)/0.2)] hover:border-[hsl(var(--border)/0.45)] hover:bg-[hsl(var(--card)/0.4)]'
              }`}
            >
              {plan.badge && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-[hsl(var(--primary))] text-primary-foreground text-[11px] font-semibold shadow-lg shadow-[hsl(var(--primary)/0.25)] whitespace-nowrap">
                  {plan.badge}
                </div>
              )}

              <h3 className="text-lg font-semibold text-foreground mb-1">{plan.name}</h3>
              <p className="text-sm text-muted-foreground mb-6 leading-relaxed">{plan.desc}</p>

              <div className="flex items-baseline gap-0.5 mb-8">
                <span className="text-4xl font-bold text-foreground font-mono">{plan.price}</span>
                {plan.priceSup && <span className="text-lg font-semibold text-foreground">{plan.priceSup}</span>}
                {plan.period && <span className="text-sm text-muted-foreground ml-1">{plan.period}</span>}
              </div>

              <ul className="space-y-3 mb-8">
                {plan.features.map((f, fi) => (
                  <li key={fi} className="flex items-start gap-3 text-sm">
                    <Check className={`w-4 h-4 mt-0.5 flex-shrink-0 ${plan.highlighted ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--positive))]'}`} />
                    <span className="text-muted-foreground">{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                to="/auth"
                className={`block w-full text-center py-3 rounded-xl font-semibold text-sm transition-all ${
                  plan.highlighted
                    ? 'bg-[hsl(var(--primary))] text-primary-foreground hover:brightness-110 shadow-lg shadow-[hsl(var(--primary)/0.2)]'
                    : 'bg-[hsl(var(--secondary))] text-foreground hover:bg-[hsl(var(--accent))] border border-[hsl(var(--border)/0.25)]'
                }`}
              >
                {plan.cta}
              </Link>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
);

/* ─────────────────────── FINAL CTA ─────────────────────── */
const FinalCTA = () => {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const videoScale = useTransform(scrollYProgress, [0, 1], [1, 1.2]);

  return (
    <section ref={ref} className="relative py-40 px-6 overflow-hidden">
      <motion.div className="absolute inset-0" style={{ scale: videoScale }}>
        <video autoPlay loop muted playsInline className="absolute inset-0 w-full h-full object-cover" src="/videos/planeta-azul.mp4" />
      </motion.div>
      <div className="absolute inset-0 bg-gradient-to-b from-[hsl(222_47%_4%/0.88)] via-[hsl(222_47%_4%/0.72)] to-[hsl(222_47%_4%/0.92)]" />

      <div className="relative max-w-3xl mx-auto text-center">
        <Reveal>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-foreground mb-6 leading-tight">
            Comece a construir uma<br />
            <span className="bg-gradient-to-r from-[hsl(var(--primary))] via-[hsl(199_89%_62%)] to-[hsl(270_60%_70%)] bg-clip-text text-transparent">
              visão maior do seu patrimônio
            </span>
          </h2>
          <p className="text-lg text-muted-foreground mb-12 max-w-xl mx-auto leading-relaxed">
            Gratuitamente. Sem cartão. Sem compromisso. Comece agora e descubra o que significa ter clareza sobre sua vida financeira.
          </p>
          <Link
            to="/auth"
            className="group inline-flex items-center gap-2.5 px-10 py-4 rounded-xl bg-[hsl(var(--primary))] text-primary-foreground font-semibold text-base hover:brightness-110 transition-all shadow-2xl shadow-[hsl(var(--primary)/0.25)]"
          >
            Criar minha conta grátis
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </Link>
        </Reveal>
      </div>
    </section>
  );
};

/* ─────────────────────── FOOTER ─────────────────────── */
const Footer = () => (
  <footer className="border-t border-[hsl(var(--border)/0.15)] bg-[hsl(222_47%_4%)]">
    <div className="max-w-6xl mx-auto px-6 py-12 flex flex-col md:flex-row items-center justify-between gap-6">
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-md bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(270_67%_62%)] flex items-center justify-center">
          <span className="text-xs font-bold text-white">F</span>
        </div>
        <span className="text-sm font-semibold text-foreground">Fortuna</span>
      </div>
      <div className="flex items-center gap-6 text-xs text-muted-foreground">
        <span>Privacidade</span>
        <span>Termos</span>
        <span>Contato</span>
      </div>
      <p className="text-xs text-muted-foreground/50">© {new Date().getFullYear()} Fortuna. Todos os direitos reservados.</p>
    </div>
  </footer>
);

/* ─────────────────────── LANDING PAGE ─────────────────────── */
const Landing = () => (
  <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
    <Navbar />
    <Hero />
    <ProductShowcase />
    <Features />
    <ProofSection />
    <Pricing />
    <FinalCTA />
    <Footer />
  </div>
);

export default Landing;
