import { createClient } from "@/utils/supabase/component";
import dayjs from "dayjs";
import React, { Fragment, useMemo } from "react";
import { Calendar, Views, dayjsLocalizer } from "react-big-calendar";
import "react-big-calendar/lib/css/react-big-calendar.css";

const ColoredDateCellWrapper = ({ children }) =>
  React.cloneElement(React.Children.only(children), {
    style: {
      backgroundColor: "#fff",
    },
  });

const djLocalizer = dayjsLocalizer(dayjs);

const supabase = createClient();

export default function Home({ events, ...props }) {
  const now = React.useMemo(() => new Date(), []);
  const { components, defaultDate, max, views } = useMemo(
    () => ({
      components: {
        timeSlotWrapper: ColoredDateCellWrapper,
      },
      defaultDate: now,
      max: dayjs().endOf("day").subtract(1, "hours").toDate(),
      views: Object.keys(Views).map((k) => Views[k]),
    }),
    []
  );

  const memoizedEvents = React.useMemo(() => {
    return events.map((event) => {
      return {
        ...event,
        title: event.name,
        start: dayjs(event.start_time).toDate(),
        end: event.end_time
          ? dayjs(event.end_time).toDate()
          : dayjs(event.start_time).add(4, "hour").toDate(),
      };
    });
  }, [events]);

  return (
    <div>
      <Fragment>
        <div className="h-screen p-12" {...props}>
          <Calendar
            components={components}
            defaultDate={defaultDate}
            defaultView={Views.MONTH}
            events={memoizedEvents}
            localizer={djLocalizer}
            max={max}
            showMultiDayTimes
            step={60}
            views={views}
          />
        </div>
      </Fragment>
    </div>
  );
}

export async function getServerSideProps() {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .order("start_time", { ascending: false });

  if (error) {
    console.error(error);
  } else {
    console.log(data);
  }

  return {
    props: {
      events: data,
    },
  };
}
