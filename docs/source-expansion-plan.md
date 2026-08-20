# Source Expansion Plan

Phase expands The Pasadena Current beyond police press releases with three source types:

1. Maryland DNR boating, waters, and fishing news -> `stories` -> AI triage -> human review.
2. Anne Arundel County Public Library upcoming events -> `events` -> local venue/date filtering.
3. Maryland CHART live traffic incidents -> `traffic_events` -> short-lived public road conditions.

## Local geography

Pasadena center is treated as approximately 39.1073, -76.5711 for coarse traffic distance filtering. Traffic items within 15 miles and in Anne Arundel County are retained, with explicit Pasadena/Mountain Road/MD 177 matches always retained.

## Editorial behavior

DNR stories use the same neutral story-triage prompt as police news. Library events are factual structured listings and do not require an AI rewrite before entering the event queue. CHART traffic data is public operational data and bypasses editorial approval only for the dedicated live-road-status module; it is never mixed into the permanent story archive.
