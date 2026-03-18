import { useRef, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useScroll, useTransform, useSpring, useInView } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';
import {
  BarChart3, PieChart, TrendingUp, Target, Shield, Zap, ArrowRight, Check, Star,
  ChevronDown, Layers, Eye, LineChart, Wallet, Globe, Lock
} from 'lucide-react';

/* ─── Scroll-aware section reveal ─── */
const Reveal = ({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-80px' });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 40 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={className}
    >
      {children}
    </motion.div>
  );
};

/* ─── Navbar ─── */
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
          ? 'bg-[hsl(222_47%_5%/0.75)] backdrop-blur-2xl border-b border-[hsl(var(--border)/0.3)] shadow-2xl shadow-black/20'
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
          <a href="#features" className="hover:text-foreground transition-colors">Recursos</a>
          <a href="#showcase" className="hover:text-foreground transition-colors">Produto</a>
          <a href="#pricing" className="hover:text-foreground transition-colors">Planos</a>
        </div>

        <div className="flex items-center gap-3">
          {user ? (
            <Link
              to="/dashboard"
              className="px-5 py-2 rounded-lg bg-[hsl(var(--primary))] text-primary-foreground text-sm font-medium hover:brightness-110 transition-all shadow-lg shadow-[hsl(var(--primary)/0.25)]"
            >
              Ir para Dashboard
            </Link>
          ) : (
            <>
              <Link
                to="/auth"
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:block"
              >
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

/* ─── Hero ─── */
const Hero = () => {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1.25]);
  const opacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);
  const y = useTransform(scrollYProgress, [0, 1], [0, 120]);
  const smoothScale = useSpring(scale, { stiffness: 50, damping: 20 });

  return (
    <section ref={ref} className="relative h-[100vh] min-h-[700px] flex items-center justify-center overflow-hidden">
      {/* Video layer */}
      <motion.div className="absolute inset-0" style={{ scale: smoothScale }}>
        <video
          autoPlay loop muted playsInline
          className="absolute inset-0 w-full h-full object-cover"
          src="/videos/hero-bg.mp4"
        />
        {/* Overlays */}
        <div className="absolute inset-0 bg-gradient-to-b from-[hsl(222_47%_5%/0.6)] via-[hsl(222_47%_5%/0.45)] to-[hsl(222_47%_5%/0.95)]" />
        <div className="absolute inset-0 bg-gradient-to-r from-[hsl(222_47%_5%/0.4)] via-transparent to-[hsl(222_47%_5%/0.4)]" />
      </motion.div>

      {/* Content */}
      <motion.div style={{ opacity, y }} className="relative z-10 max-w-4xl mx-auto px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[hsl(var(--border)/0.4)] bg-[hsl(var(--card)/0.4)] backdrop-blur-sm text-xs text-muted-foreground mb-8">
            <Star className="w-3.5 h-3.5 text-[hsl(var(--primary))]" />
            Plataforma de inteligência patrimonial
          </div>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.6 }}
          className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.08] mb-6"
        >
          <span className="text-foreground">Seu patrimônio em</span>
          <br />
          <span className="bg-gradient-to-r from-[hsl(var(--primary))] via-[hsl(199_89%_58%)] to-[hsl(270_67%_72%)] bg-clip-text text-transparent">
            uma nova órbita
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.8 }}
          className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed"
        >
          Organize, acompanhe e expanda seus investimentos com clareza e visão estratégica.
          O Fortuna transforma dados em decisões inteligentes.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 1 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <Link
            to="/auth"
            className="group px-8 py-3.5 rounded-xl bg-[hsl(var(--primary))] text-primary-foreground font-semibold text-base hover:brightness-110 transition-all shadow-xl shadow-[hsl(var(--primary)/0.3)] flex items-center gap-2"
          >
            Começar gratuitamente
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </Link>
          <a
            href="#features"
            className="px-8 py-3.5 rounded-xl border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--card)/0.3)] backdrop-blur-sm text-foreground font-medium text-base hover:bg-[hsl(var(--card)/0.5)] transition-all"
          >
            Explorar recursos
          </a>
        </motion.div>

        {/* Scroll indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2"
        >
          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          >
            <ChevronDown className="w-5 h-5 text-muted-foreground/50" />
          </motion.div>
        </motion.div>
      </motion.div>
    </section>
  );
};

/* ─── Value Proposition ─── */
const ValueProp = () => (
  <section className="relative py-28 px-6 overflow-hidden">
    <div className="absolute inset-0 bg-gradient-to-b from-background via-[hsl(222_47%_6%)] to-background" />
    <div className="relative max-w-5xl mx-auto text-center">
      <Reveal>
        <p className="text-xs uppercase tracking-[0.25em] text-[hsl(var(--primary))] font-semibold mb-4">Por que o Fortuna</p>
        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-foreground mb-6 leading-tight">
          Uma visão mais inteligente<br className="hidden sm:block" /> do seu patrimônio
        </h2>
        <p className="text-muted-foreground text-lg max-w-2xl mx-auto leading-relaxed">
          Chega de planilhas desconectadas e dados espalhados. O Fortuna centraliza tudo o que você precisa
          para entender, acompanhar e evoluir sua vida financeira com clareza.
        </p>
      </Reveal>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16">
        {[
          { icon: Eye, title: 'Visão Completa', desc: 'Veja todo seu patrimônio consolidado em um único painel, com dados em tempo real e acompanhamento detalhado.' },
          { icon: TrendingUp, title: 'Evolução Clara', desc: 'Acompanhe rentabilidade, comparativos com benchmarks e a evolução de cada ativo ao longo do tempo.' },
          { icon: Target, title: 'Decisões Estratégicas', desc: 'Rebalanceamento inteligente, scoring de ativos e valuations para tomar decisões com mais confiança.' },
        ].map((item, i) => (
          <Reveal key={i} delay={i * 0.12}>
            <div className="group p-8 rounded-2xl border border-[hsl(var(--border)/0.3)] bg-[hsl(var(--card)/0.4)] hover:bg-[hsl(var(--card)/0.7)] hover:border-[hsl(var(--border)/0.6)] transition-all duration-500">
              <div className="w-12 h-12 rounded-xl bg-[hsl(var(--primary)/0.1)] flex items-center justify-center mb-5 group-hover:bg-[hsl(var(--primary)/0.15)] transition-colors">
                <item.icon className="w-6 h-6 text-[hsl(var(--primary))]" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-3">{item.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
);

/* ─── Video Showcase (scroll-driven) ─── */
const Showcase = () => {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const scale = useTransform(scrollYProgress, [0, 0.5, 1], [0.85, 1, 0.95]);
  const rotateX = useTransform(scrollYProgress, [0, 0.5, 1], [8, 0, -4]);
  const opacity = useTransform(scrollYProgress, [0, 0.3, 0.7, 1], [0.3, 1, 1, 0.5]);

  return (
    <section id="showcase" ref={ref} className="relative py-28 px-6">
      <div className="max-w-6xl mx-auto">
        <Reveal className="text-center mb-16">
          <p className="text-xs uppercase tracking-[0.25em] text-[hsl(var(--primary))] font-semibold mb-4">Produto</p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-4">
            Seu universo financeiro, em uma tela
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Dashboard completo com métricas, gráficos de alocação, rentabilidade comparada e insights automatizados.
          </p>
        </Reveal>

        <motion.div
          style={{ scale, rotateX, opacity, perspective: 1200 }}
          className="relative rounded-2xl overflow-hidden border border-[hsl(var(--border)/0.3)] shadow-2xl shadow-black/40"
        >
          <div className="aspect-video relative bg-[hsl(var(--card))]">
            <video
              autoPlay loop muted playsInline
              className="w-full h-full object-cover"
              src="/videos/hero-bg.mp4"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[hsl(222_47%_5%/0.7)] to-transparent" />

            {/* Floating metric cards */}
            <div className="absolute inset-0 flex items-end p-8">
              <div className="flex gap-4 flex-wrap">
                {[
                  { label: 'Patrimônio', value: 'R$ 247.832', change: '+12.4%' },
                  { label: 'Dividendos 12m', value: 'R$ 8.190', change: '+3.2%' },
                  { label: 'Rentabilidade', value: '+18.7%', change: 'vs CDI' },
                ].map((m, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.3 + i * 0.15 }}
                    className="px-5 py-3.5 rounded-xl bg-[hsl(222_47%_5%/0.7)] backdrop-blur-xl border border-[hsl(var(--border)/0.4)]"
                  >
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{m.label}</p>
                    <p className="text-lg font-semibold text-foreground font-mono">{m.value}</p>
                    <p className="text-xs text-[hsl(var(--positive))]">{m.change}</p>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

/* ─── Features grid ─── */
const features = [
  { icon: PieChart, title: 'Alocação por Classe', desc: 'Visualize a composição exata do seu patrimônio por classe de ativo, com metas e bandas configuráveis.' },
  { icon: LineChart, title: 'Rentabilidade Comparada', desc: 'Compare seu retorno com CDI, IPCA, IBOV e S&P 500 em diferentes períodos.' },
  { icon: Target, title: 'Rebalanceamento', desc: 'Receba sugestões de alocação para manter sua carteira alinhada à estratégia.' },
  { icon: Layers, title: 'Scoring de Ativos', desc: 'Avalie qualidade, valuation, dividendos, crescimento e risco de cada posição.' },
  { icon: Wallet, title: 'Gestão de Aportes', desc: 'Registre e acompanhe todos os aportes com detalhamento por ativo e data.' },
  { icon: Globe, title: 'Valuations', desc: 'Modelos de precificação como Bazin e Graham integrados para cada ativo.' },
];

const Features = () => (
  <section id="features" className="relative py-28 px-6">
    <div className="absolute inset-0 bg-gradient-to-b from-background via-[hsl(222_47%_6%)] to-background" />
    <div className="relative max-w-6xl mx-auto">
      <Reveal className="text-center mb-16">
        <p className="text-xs uppercase tracking-[0.25em] text-[hsl(var(--primary))] font-semibold mb-4">Recursos</p>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-4">
          Tudo que você precisa para<br className="hidden sm:block" /> gerenciar investimentos
        </h2>
        <p className="text-muted-foreground max-w-xl mx-auto">
          Ferramentas profissionais em uma interface pensada para clareza e ação.
        </p>
      </Reveal>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {features.map((f, i) => (
          <Reveal key={i} delay={i * 0.08}>
            <div className="group relative p-6 rounded-2xl border border-[hsl(var(--border)/0.2)] bg-[hsl(var(--card)/0.3)] hover:bg-[hsl(var(--card)/0.6)] hover:border-[hsl(var(--border)/0.5)] transition-all duration-500">
              <f.icon className="w-5 h-5 text-[hsl(var(--primary))] mb-4" />
              <h3 className="text-base font-semibold text-foreground mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
);

/* ─── Social proof / numbers ─── */
const Numbers = () => {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const videoScale = useTransform(scrollYProgress, [0, 0.5, 1], [1.15, 1, 1.1]);
  const videoOpacity = useTransform(scrollYProgress, [0, 0.3, 0.7, 1], [0.15, 0.25, 0.25, 0.1]);

  return (
    <section ref={ref} className="relative py-28 px-6 overflow-hidden">
      {/* Video background parallax */}
      <motion.div className="absolute inset-0" style={{ scale: videoScale }}>
        <video autoPlay loop muted playsInline className="absolute inset-0 w-full h-full object-cover" src="/videos/hero-bg.mp4" />
      </motion.div>
      <motion.div className="absolute inset-0 bg-[hsl(222_47%_5%)]" style={{ opacity: useTransform(videoOpacity, v => 1 - v) }} />

      <div className="relative max-w-5xl mx-auto text-center">
        <Reveal>
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-16 tracking-tight">
            Construído para quem leva<br className="hidden sm:block" /> patrimônio a sério
          </h2>
        </Reveal>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {[
            { value: '100%', label: 'Seguro e privado' },
            { value: '6+', label: 'Módulos analíticos' },
            { value: '5+', label: 'Benchmarks' },
            { value: '∞', label: 'Potencial patrimonial' },
          ].map((stat, i) => (
            <Reveal key={i} delay={i * 0.1}>
              <div className="text-center">
                <p className="text-4xl sm:text-5xl font-bold text-foreground font-mono mb-2">{stat.value}</p>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
};

/* ─── Pricing ─── */
const plans = [
  {
    name: 'Órbita',
    price: 'Grátis',
    period: '',
    desc: 'Para quem quer começar a organizar a vida financeira com mais clareza.',
    features: [
      'Até 10 ativos acompanhados',
      'Dashboard básico',
      'Rentabilidade simplificada',
      'Alocação por classe',
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
    desc: 'Mais visão, mais controle e mais profundidade para sua carteira.',
    badge: 'Melhor custo-benefício',
    features: [
      'Até 50 ativos acompanhados',
      'Dashboard completo',
      'Rentabilidade comparada (CDI, IBOV, S&P 500)',
      'Rebalanceamento inteligente',
      'Scoring de ativos',
      'Gestão de aportes detalhada',
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
    desc: 'Experiência completa para acompanhar e expandir seu patrimônio.',
    features: [
      'Ativos ilimitados',
      'Todos os recursos do Constelação',
      'Valuations (Bazin, Graham)',
      'Correlação de ativos',
      'Relatórios avançados',
      'Exportação e backup completo',
      'Metas patrimoniais',
      'Carteiras ilimitadas',
      'Suporte prioritário',
    ],
    cta: 'Assinar Galáxia',
    highlighted: false,
  },
];

const Pricing = () => (
  <section id="pricing" className="relative py-28 px-6">
    <div className="absolute inset-0 bg-gradient-to-b from-background via-[hsl(222_47%_6%)] to-background" />
    <div className="relative max-w-6xl mx-auto">
      <Reveal className="text-center mb-16">
        <p className="text-xs uppercase tracking-[0.25em] text-[hsl(var(--primary))] font-semibold mb-4">Planos</p>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-4">
          Escolha sua órbita
        </h2>
        <p className="text-muted-foreground max-w-xl mx-auto">
          Do gratuito ao premium — cada plano é pensado para uma fase da sua jornada patrimonial.
        </p>
      </Reveal>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
        {plans.map((plan, i) => (
          <Reveal key={i} delay={i * 0.1}>
            <div
              className={`relative rounded-2xl p-8 transition-all duration-500 ${
                plan.highlighted
                  ? 'bg-gradient-to-b from-[hsl(var(--primary)/0.08)] to-[hsl(var(--card)/0.6)] border-2 border-[hsl(var(--primary)/0.4)] shadow-2xl shadow-[hsl(var(--primary)/0.1)] scale-[1.02]'
                  : 'bg-[hsl(var(--card)/0.3)] border border-[hsl(var(--border)/0.3)] hover:border-[hsl(var(--border)/0.5)]'
              }`}
            >
              {plan.badge && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-[hsl(var(--primary))] text-primary-foreground text-xs font-semibold shadow-lg shadow-[hsl(var(--primary)/0.3)]">
                  {plan.badge}
                </div>
              )}

              <h3 className="text-lg font-semibold text-foreground mb-1">{plan.name}</h3>
              <p className="text-sm text-muted-foreground mb-6">{plan.desc}</p>

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
                    ? 'bg-[hsl(var(--primary))] text-primary-foreground hover:brightness-110 shadow-lg shadow-[hsl(var(--primary)/0.25)]'
                    : 'bg-[hsl(var(--secondary))] text-foreground hover:bg-[hsl(var(--accent))] border border-[hsl(var(--border)/0.3)]'
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

/* ─── Final CTA ─── */
const FinalCTA = () => {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const videoScale = useTransform(scrollYProgress, [0, 1], [1, 1.3]);

  return (
    <section ref={ref} className="relative py-36 px-6 overflow-hidden">
      <motion.div className="absolute inset-0" style={{ scale: videoScale }}>
        <video autoPlay loop muted playsInline className="absolute inset-0 w-full h-full object-cover" src="/videos/hero-bg.mp4" />
      </motion.div>
      <div className="absolute inset-0 bg-gradient-to-b from-[hsl(222_47%_5%/0.85)] via-[hsl(222_47%_5%/0.7)] to-[hsl(222_47%_5%/0.9)]" />

      <div className="relative max-w-3xl mx-auto text-center">
        <Reveal>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-foreground mb-6 leading-tight">
            Coloque seu patrimônio<br />
            <span className="bg-gradient-to-r from-[hsl(var(--primary))] to-[hsl(199_89%_58%)] bg-clip-text text-transparent">
              em uma nova órbita
            </span>
          </h2>
          <p className="text-lg text-muted-foreground mb-10 max-w-xl mx-auto">
            Comece gratuitamente e descubra uma forma mais inteligente de enxergar, acompanhar e expandir sua fortuna.
          </p>
          <Link
            to="/auth"
            className="group inline-flex items-center gap-2 px-10 py-4 rounded-xl bg-[hsl(var(--primary))] text-primary-foreground font-semibold text-base hover:brightness-110 transition-all shadow-2xl shadow-[hsl(var(--primary)/0.3)]"
          >
            Criar minha conta grátis
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </Link>
        </Reveal>
      </div>
    </section>
  );
};

/* ─── Footer ─── */
const Footer = () => (
  <footer className="border-t border-[hsl(var(--border)/0.2)] bg-[hsl(222_47%_4%)]">
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
      <p className="text-xs text-muted-foreground/60">© {new Date().getFullYear()} Fortuna. Todos os direitos reservados.</p>
    </div>
  </footer>
);

/* ─── Landing Page ─── */
const Landing = () => {
  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      <Navbar />
      <Hero />
      <ValueProp />
      <Showcase />
      <Features />
      <Numbers />
      <Pricing />
      <FinalCTA />
      <Footer />
    </div>
  );
};

export default Landing;
