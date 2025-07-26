import { AccountsFromDB, EventFromDB } from '@/types';
import { AnimatePresence, motion } from 'framer-motion';
import React, { useEffect, useState } from 'react';

import { EventBentoGrid } from '@/components/EventBentoGrid';
import { EventGrid } from '@/components/EventGrid';
import { EventList } from '@/components/EventList';
import { FilterBar } from '@/components/FilterBar';
import { NavBar } from '../components/NavBar';
import { SEO } from '@/components/SEO';
import { app } from '@/config/app';
/* eslint-disable @typescript-eslint/no-unused-vars */
import { createClient } from '@/utils/supabase/static-props';
import { groupEventsByTime } from '@/utils/eventUtils';
import { useRouter } from 'next/router';

export default function Home({ events, accounts }: { events: EventFromDB[]; accounts: AccountsFromDB[] }) {
    const router = useRouter();
    const [selectedAccount, setSelectedAccount] = useState<number | null>(null);
    const [filteredEvents, setFilteredEvents] = useState(events);
    const [view, setView] = useState<'card' | 'list' | 'bento'>('card');
    const [selectedMonth, setSelectedMonth] = useState<string>('All Months');
    const [selectedYear, setSelectedYear] = useState<string>('All Years');

    useEffect(() => {
        setFilteredEvents(
            selectedAccount ? events.filter((event) => Number(event?.account?.id) === selectedAccount) : events,
        );
    }, [selectedAccount, events]);

    const { upcomingEvents, recentEvents, pastEvents } = groupEventsByTime(filteredEvents, selectedMonth, selectedYear);

    const seoProps = {
        title: `${app.title} - All Tech Events in ${app.city}`,
        description: `Discover and explore exciting tech events in ${app.city} with ${app.title}. RSVP to your next meetup, workshops, hackathons, conferences,and more!`,
        url: app.url,
        imageUrl: `${app.url}/og-image.jpg`,
        noindex: true,
    };

    useEffect(() => {
        // Restore scroll position if returning from an event page
        if (router.asPath === router.route) {
            const scrollPosition = sessionStorage.getItem('scrollPosition');
            if (scrollPosition) {
                window.scrollTo(0, parseInt(scrollPosition, 10));
                sessionStorage.removeItem('scrollPosition');
            }
        }

        // Save scroll position before leaving the page
        const handleRouteChange = () => {
            sessionStorage.setItem('scrollPosition', window.scrollY.toString());
        };

        router.events.on('routeChangeStart', handleRouteChange);

        return () => {
            router.events.off('routeChangeStart', handleRouteChange);
        };
    }, [router]);

    const pageVariants = {
        initial: { opacity: 0, y: 20 },
        in: { opacity: 1, y: 0 },
        out: { opacity: 0, y: -20 },
    };

    const pageTransition = {
        type: 'tween',
        ease: 'anticipate',
        duration: 0.5,
    };

    return (
        <>
            <SEO {...seoProps} />

            <motion.div
                initial="initial"
                animate="in"
                exit="out"
                variants={pageVariants}
                transition={pageTransition}
                className="min-h-screen bg-gray-100 dark:bg-gray-900"
            >
                <div className="space-y-2">
                    <FilterBar
                        accounts={accounts}
                        selectedAccount={selectedAccount}
                        setSelectedAccount={setSelectedAccount}
                        view={view}
                        setView={setView}
                    />
                    <div className="container mx-auto px-4 py-4 flex flex-col md:flex-row items-center justify-end">
                        <NavBar
                            accounts={accounts}
                            selectedAccount={selectedAccount}
                            setSelectedAccount={setSelectedAccount}
                            view={view}
                            setView={setView}
                            selectedMonth={selectedMonth}
                            setSelectedMonth={setSelectedMonth}
                            selectedYear={selectedYear}
                            setSelectedYear={setSelectedYear}
                        />
                    </div>
                </div>

                <AnimatePresence mode="wait">
                    {view === 'card' && (
                        <motion.div
                            key="card"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.3 }}
                        >
                            <EventGrid
                                accounts={accounts}
                                selectedAccount={selectedAccount}
                                setSelectedAccount={setSelectedAccount}
                                view={view}
                                setView={setView}
                                upcomingEvents={upcomingEvents}
                                recentEvents={recentEvents}
                                pastEvents={pastEvents}
                            />
                        </motion.div>
                    )}
                    {view === 'list' && (
                        <motion.div
                            key="list"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.3 }}
                        >
                            <EventList
                                upcomingEvents={upcomingEvents}
                                recentEvents={recentEvents}
                                pastEvents={pastEvents}
                                accounts={accounts}
                                selectedAccount={selectedAccount}
                                setSelectedAccount={setSelectedAccount}
                                view={view}
                                setView={setView}
                            />
                        </motion.div>
                    )}
                    {view === 'bento' && (
                        <motion.div
                            key="bento"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.3 }}
                        >
                            <EventBentoGrid
                                upcomingEvents={upcomingEvents}
                                recentEvents={recentEvents}
                                pastEvents={pastEvents}
                                accounts={accounts}
                                selectedAccount={selectedAccount}
                                setSelectedAccount={setSelectedAccount}
                                view={view}
                                setView={setView}
                            />
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>
        </>
    );
}

export async function getStaticProps() {
    try {
        const supabase = createClient();
        const { data, error } = await supabase.from('events').select('*').order('start_time', { ascending: false });
        console.log('🚀 ~ getStaticProps ~ data:', data);

        const { data: accounts, error: accountsError } = await supabase.from('accounts').select('*');

        if (error || accountsError) {
            throw error;
        }

        return {
            props: {
                events: data ?? [],
                accounts,
            },
            revalidate: 60, // Revalidate every 60 seconds
            // Add notFound if no data is available
            notFound: !data || data.length === 0,
        };
    } catch (error) {
        console.error('Error fetching data:', error);
        // Return fallback data in case of error
        return {
            props: {
                events: [],
                accounts: [],
            },
            revalidate: 30, // Shorter revalidation time on error
        };
    }
}
