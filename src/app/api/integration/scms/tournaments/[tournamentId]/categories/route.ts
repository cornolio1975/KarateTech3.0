import { NextResponse } from 'next/server';
import { authorizeScms, receiverDb, receiverTournament, unavailable } from '@/lib/integrations/scms';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request:Request,context:{params:Promise<{tournamentId:string}>}) {
  const denied=authorizeScms(request);if(denied)return denied;
  try {
    const {tournamentId}=await context.params;
    if(tournamentId!==receiverTournament())return NextResponse.json({success:false,error:'This tournament is not configured for SCMS registrations.'},{status:422});
    const {data,error}=await receiverDb().from('categories').select('id,name,gender,min_age,max_age,min_weight,max_weight,format,status').eq('tournament_id',tournamentId).order('name');
    if(error)return unavailable();
    return NextResponse.json({success:true,categories:data||[]});
  }catch{return unavailable();}
}
