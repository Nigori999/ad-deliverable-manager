using System.Text;
using AdDeliverableManager.Models;
using Microsoft.Data.Sqlite;

namespace AdDeliverableManager.Services;

public sealed partial class DeliverableRepository
{
    private readonly DatabaseService _database;
    public DeliverableRepository(DatabaseService database) => _database = database;

    public async Task<object> SearchAsync(string? keyword,int? departmentId,int? typeId,int? projectId,string? status,string? confidentiality,string? sharePolicy,int page,int pageSize,CancellationToken cancellationToken,IReadOnlyList<int>? allowedDeliverableIds=null,int? categoryId=null)
    {
        page=Math.Max(1,page);pageSize=Math.Clamp(pageSize,10,100);
        await using var connection=await _database.OpenConnectionAsync(cancellationToken);
        var where=new StringBuilder(" WHERE d.LifecycleStatus <> 'ARCHIVED' ");
        var parameters=new List<(string Name,object? Value)>();
        if(allowedDeliverableIds is not null){if(allowedDeliverableIds.Count==0)return new{items=Array.Empty<object>(),total=0,page,pageSize};var names=new List<string>();for(var i=0;i<allowedDeliverableIds.Count;i++){var name="$scopeId"+i;names.Add(name);parameters.Add((name,allowedDeliverableIds[i]));}where.Append($" AND d.Id IN ({string.Join(',',names)}) ");}
        if(!string.IsNullOrWhiteSpace(keyword)){where.Append(" AND (d.DeliverableCode LIKE $keyword OR d.UnifiedName LIKE $keyword OR cat.CategoryCode LIKE $keyword OR cat.CategoryName LIKE $keyword OR d.ResponsiblePerson LIKE $keyword) ");parameters.Add(("$keyword",$"%{keyword.Trim()}%"));}
        if(departmentId.HasValue){where.Append(" AND d.DepartmentId=$departmentId ");parameters.Add(("$departmentId",departmentId));}
        if(typeId.HasValue){where.Append(" AND d.DeliverableTypeId=$typeId ");parameters.Add(("$typeId",typeId));}
        if(categoryId.HasValue){where.Append(" AND d.CategoryId=$categoryId ");parameters.Add(("$categoryId",categoryId));}
        if(projectId.HasValue){where.Append(" AND d.ProjectId=$projectId ");parameters.Add(("$projectId",projectId));}
        if(!string.IsNullOrWhiteSpace(status)){where.Append(" AND COALESCE(v.VersionStatus,'NO_VERSION')=$status ");parameters.Add(("$status",status));}
        if(!string.IsNullOrWhiteSpace(confidentiality)){where.Append(" AND d.DefaultConfidentiality=$confidentiality ");parameters.Add(("$confidentiality",confidentiality));}
        if(!string.IsNullOrWhiteSpace(sharePolicy)){where.Append(" AND d.DefaultSharePolicy=$sharePolicy ");parameters.Add(("$sharePolicy",sharePolicy));}
        await using var countCommand=connection.CreateCommand();countCommand.CommandText=$"SELECT COUNT(*) FROM Deliverables d JOIN DeliverableCategories cat ON cat.Id=d.CategoryId LEFT JOIN DeliverableVersions v ON v.Id=d.CurrentVersionId {where}";foreach(var(name,value)in parameters)countCommand.Parameters.AddValue(name,value);var total=Convert.ToInt32(await countCommand.ExecuteScalarAsync(cancellationToken));
        await using var command=connection.CreateCommand();command.CommandText=$"""
            SELECT d.Id,d.DeliverableCode,d.UnifiedName,dep.DepartmentName,t.TypeName,cat.Id,cat.CategoryCode,cat.CategoryName,p.ProjectName,d.ResponsiblePerson,d.DefaultConfidentiality,d.DefaultSharePolicy,d.LifecycleStatus,d.UpdatedAt,d.Revision,v.InternalVersion,v.VersionStatus,v.ServerPath,
                   CASE WHEN EXISTS(SELECT 1 FROM DeliverableVersions dv WHERE dv.DeliverableId=d.Id)
                          AND NOT EXISTS(SELECT 1 FROM DeliverableVersions dv WHERE dv.DeliverableId=d.Id AND dv.VersionStatus<>'DRAFT')
                          AND NOT EXISTS(SELECT 1 FROM ChangeRecords c WHERE c.DeliverableId=d.Id)
                          AND NOT EXISTS(SELECT 1 FROM LifecycleRecords l WHERE l.DeliverableId=d.Id)
                          AND NOT EXISTS(SELECT 1 FROM DeliverableRelations r WHERE r.SourceDeliverableId=d.Id OR r.TargetDeliverableId=d.Id)
                          AND NOT EXISTS(SELECT 1 FROM ProductBaselineHardware bh JOIN DeliverableVersions bv ON bv.Id=bh.SoftwareVersionId WHERE bv.DeliverableId=d.Id)
                          AND NOT EXISTS(SELECT 1 FROM ProductBaselineDeliverables bd JOIN DeliverableVersions bv ON bv.Id=bd.VersionId WHERE bv.DeliverableId=d.Id)
                        THEN 1 ELSE 0 END AS CanDeleteDraft
            FROM Deliverables d JOIN Departments dep ON dep.Id=d.DepartmentId JOIN DeliverableTypes t ON t.Id=d.DeliverableTypeId JOIN DeliverableCategories cat ON cat.Id=d.CategoryId JOIN Projects p ON p.Id=d.ProjectId LEFT JOIN DeliverableVersions v ON v.Id=d.CurrentVersionId {where} ORDER BY d.UpdatedAt DESC LIMIT $limit OFFSET $offset;
            """;foreach(var(name,value)in parameters)command.Parameters.AddValue(name,value);command.Parameters.AddValue("$limit",pageSize);command.Parameters.AddValue("$offset",(page-1)*pageSize);
        var items=new List<object>();await using var reader=await command.ExecuteReaderAsync(cancellationToken);while(await reader.ReadAsync(cancellationToken))items.Add(new{id=reader.GetInt32(0),code=reader.GetString(1),name=reader.GetString(2),department=reader.GetString(3),type=reader.GetString(4),categoryId=reader.GetInt32(5),categoryCode=reader.GetString(6),category=reader.GetString(7),project=reader.GetString(8),responsiblePerson=reader.GetString(9),confidentiality=reader.GetString(10),sharePolicy=reader.GetString(11),lifecycleStatus=reader.GetString(12),updatedAt=reader.GetString(13),revision=reader.GetInt32(14),currentVersion=reader.GetNullableString(15),versionStatus=reader.GetNullableString(16),serverPath=reader.GetNullableString(17),canDeleteDraft=reader.GetInt32(18)==1});return new{items,total,page,pageSize};
    }

    public async Task<object?> GetAsync(int id,CancellationToken cancellationToken)
    {
        await using var connection=await _database.OpenConnectionAsync(cancellationToken);await using var command=connection.CreateCommand();command.CommandText="""
            SELECT d.Id,d.DeliverableCode,d.UnifiedName,d.DepartmentId,dep.DepartmentName,d.DeliverableTypeId,t.TypeCode,t.TypeName,d.CategoryId,cat.CategoryCode,cat.CategoryName,d.ProjectId,p.ProjectName,d.BusinessModule,d.ResponsiblePerson,d.DefaultConfidentiality,d.DefaultSharePolicy,d.Description,d.CurrentVersionId,d.LifecycleStatus,d.CreatedBy,d.CreatedAt,d.UpdatedAt,d.Revision
            FROM Deliverables d JOIN Departments dep ON dep.Id=d.DepartmentId JOIN DeliverableTypes t ON t.Id=d.DeliverableTypeId JOIN DeliverableCategories cat ON cat.Id=d.CategoryId JOIN Projects p ON p.Id=d.ProjectId WHERE d.Id=$id;
            """;command.Parameters.AddValue("$id",id);object? deliverable=null;await using(var reader=await command.ExecuteReaderAsync(cancellationToken)){if(await reader.ReadAsync(cancellationToken))deliverable=new{id=reader.GetInt32(0),code=reader.GetString(1),name=reader.GetString(2),departmentId=reader.GetInt32(3),department=reader.GetString(4),typeId=reader.GetInt32(5),typeCode=reader.GetString(6),type=reader.GetString(7),categoryId=reader.GetInt32(8),categoryCode=reader.GetString(9),category=reader.GetString(10),projectId=reader.GetInt32(11),project=reader.GetString(12),businessModule=reader.GetNullableString(13),responsiblePerson=reader.GetString(14),confidentiality=reader.GetString(15),sharePolicy=reader.GetString(16),description=reader.GetNullableString(17),currentVersionId=reader.IsDBNull(18)?(int?)null:reader.GetInt32(18),lifecycleStatus=reader.GetString(19),createdBy=reader.GetString(20),createdAt=reader.GetString(21),updatedAt=reader.GetString(22),revision=reader.GetInt32(23)};}
        if(deliverable is null)return null;var versions=new List<object>();await using var versionsCommand=connection.CreateCommand();versionsCommand.CommandText="""
            SELECT Id,InternalVersion,OriginalVersion,OriginalFileName,UnifiedFileName,ServerPath,FileExtension,FileSize,HashAlgorithm,HashValue,VersionStatus,ChangeSummary,ConfidentialityLevel,SharePolicy,Author,Reviewer,Approver,PlannedReleaseDate,ReleaseDate,EffectiveDate,ExpiryDate,IsCurrent,CreatedBy,CreatedAt,UpdatedAt,Revision FROM DeliverableVersions WHERE DeliverableId=$id ORDER BY CreatedAt DESC;
            """;versionsCommand.Parameters.AddValue("$id",id);await using var versionReader=await versionsCommand.ExecuteReaderAsync(cancellationToken);while(await versionReader.ReadAsync(cancellationToken))versions.Add(new{id=versionReader.GetInt32(0),internalVersion=versionReader.GetString(1),originalVersion=versionReader.GetNullableString(2),originalFileName=versionReader.GetString(3),unifiedFileName=versionReader.GetString(4),serverPath=versionReader.GetString(5),fileExtension=versionReader.GetNullableString(6),fileSize=versionReader.GetNullableInt64(7),hashAlgorithm=versionReader.GetNullableString(8),hashValue=versionReader.GetNullableString(9),status=versionReader.GetString(10),changeSummary=versionReader.GetNullableString(11),confidentiality=versionReader.GetString(12),sharePolicy=versionReader.GetString(13),author=versionReader.GetString(14),reviewer=versionReader.GetNullableString(15),approver=versionReader.GetNullableString(16),plannedReleaseDate=versionReader.GetNullableString(17),releaseDate=versionReader.GetNullableString(18),effectiveDate=versionReader.GetNullableString(19),expiryDate=versionReader.GetNullableString(20),isCurrent=versionReader.GetInt32(21)==1,createdBy=versionReader.GetString(22),createdAt=versionReader.GetString(23),updatedAt=versionReader.GetString(24),revision=versionReader.GetInt32(25)});return new{deliverable,versions};
    }
}
